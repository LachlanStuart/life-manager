import * as React from 'react';
import { createPortal } from 'react-dom';
import { effectiveIncluded } from '../src/domain';
import { type Item, type ItemCommand, type WorkspaceSettings } from '../src/types';
import { buildKanbanModel, reorderedSiblingIds, type KanbanDropPosition } from './kanban-helpers';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties';
import { effectivePropertyValue } from './PropertySelect';
import { presentationProperty, propertyPresentation } from './property-presentation';
import type { ViewSort } from './view-sort';
import './kanban.css';

export interface KanbanProps {
  matchingIds?: ReadonlySet<string>;
  showAll?: boolean;
  onCreate?: (parentId: string | null, values: Record<string, string | null>) => void;
  items: Item[];
  sort?: ViewSort;
  settings?: WorkspaceSettings;
  groupPropertyId?: string | null;
  colorPropertyId?: string | null;
  focusId: string | null;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  onCommand: (command: ItemCommand) => Promise<void>;
}

type DropTarget =
  | { kind: 'column'; status: string | null }
  | { kind: 'group'; status: string | null; parentId: string | null }
  | { kind: 'card'; status: string | null; targetId: string; position: KanbanDropPosition };

type DragState = {
  id: string;
  pointerId: number;
  target: DropTarget | null;
  active: boolean;
  startX: number; startY: number;
  x: number; y: number;
  left: number; top: number; width: number; height: number;
  fontSize: number;
};

function cardDropTarget(element: Element | null, clientY: number): DropTarget | null {
  const card = element?.closest<HTMLElement>('[data-lm-kanban-card]');
  if (card) {
    const rect = card.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    return {
      kind: 'card',
      status: card.dataset.kanbanStatus || null,
      targetId: card.dataset.kanbanCard ?? '',
      position: clientY < midpoint ? 'before' : 'after',
    };
  }
  const group = element?.closest<HTMLElement>('[data-lm-kanban-group]');
  if (group) {
    return {
      kind: 'group',
      status: group.dataset.kanbanStatus || null,
      parentId: group.dataset.kanbanParent || null,
    };
  }
  const column = element?.closest<HTMLElement>('[data-lm-kanban-column]');
  if (column) return { kind: 'column', status: column.dataset.kanbanColumn || null };
  return null;
}

function sameDropTarget(left: DropTarget | null, right: DropTarget | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind || left.status !== right.status) return false;
  if (left.kind === 'column' && right.kind === 'column') return true;
  if (left.kind === 'group' && right.kind === 'group') return left.parentId === right.parentId;
  if (left.kind === 'card' && right.kind === 'card') {
    return left.targetId === right.targetId && left.position === right.position;
  }
  return false;
}

function columnTargetAtPoint(board: HTMLElement | null, clientX: number, clientY: number): DropTarget | null {
  if (!board) return null;
  const boardRect = board.getBoundingClientRect();
  if (clientX < boardRect.left || clientX > boardRect.right || clientY < boardRect.top || clientY > boardRect.bottom) return null;
  const columns = Array.from(board.querySelectorAll<HTMLElement>('[data-lm-kanban-column]'));
  const column = columns.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right;
  });
  return column ? { kind: 'column', status: column.dataset.kanbanColumn || null } : null;
}

export function Kanban({ showAll = false, onCreate, matchingIds, items, focusId, selectedId, disabled, onSelect, onContextMenu, onCommand, sort = 'Order', settings = DEFAULT_WORKSPACE_SETTINGS, groupPropertyId, colorPropertyId }: KanbanProps) {
  const groupProperty = presentationProperty(settings, groupPropertyId);
  const colorProperty = presentationProperty(settings, colorPropertyId);
  const model = React.useMemo(() => buildKanbanModel(items, focusId, sort, settings, groupPropertyId, matchingIds, showAll), [items, focusId, sort, settings, groupPropertyId, matchingIds, showAll]);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const suppressClick = React.useRef(false);
  const dragRef = React.useRef<DragState | null>(null);
  const [applying, setApplying] = React.useState(false);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const locked = disabled || applying;
  const byId = React.useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerType = React.useRef('mouse');
  const touchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchPress = React.useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const cancelTouch = React.useCallback(() => {
    if (touchTimer.current !== null) clearTimeout(touchTimer.current);
    touchTimer.current = null;
    touchPress.current = null;
  }, []);
  React.useEffect(() => cancelTouch, [cancelTouch]);

  const cancelDrag = React.useCallback((pointerId?: number) => {
    if (pointerId === undefined || touchPress.current?.pointerId === pointerId) cancelTouch();
    const current = dragRef.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return;
    if (current.active) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    dragRef.current = null;
    pointerRef.current = null;
    setDrag(null);
  }, [cancelTouch]);

  React.useEffect(() => {
    // A changed branch or a newly locked workspace invalidates the pointer's target.
    if (disabled) cancelDrag();
  }, [disabled, cancelDrag]);

  React.useEffect(() => {
    // Changing the focused branch changes the board underneath the pointer.
    cancelDrag();
  }, [focusId, sort, settings, groupPropertyId, matchingIds, showAll, cancelDrag]);

  React.useEffect(() => {
    const onBlur = () => cancelDrag();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDrag();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelDrag]);

  const scrollBoardAtPointer = (clientX: number, clientY: number) => {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const edge = 52;
    if (clientX < rect.left + edge) {
      board.scrollLeft -= Math.max(4, Math.ceil((rect.left + edge - clientX) / 4));
    } else if (clientX > rect.right - edge) {
      board.scrollLeft += Math.max(4, Math.ceil((clientX - (rect.right - edge)) / 4));
    }
    if (clientY < rect.top + edge) {
      board.scrollTop -= Math.max(4, Math.ceil((rect.top + edge - clientY) / 4));
    } else if (clientY > rect.bottom - edge) {
      board.scrollTop += Math.max(4, Math.ceil((clientY - (rect.bottom - edge)) / 4));
    }
  };

  const updateDropTargetAtPoint = (pointerId: number, clientX: number, clientY: number) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== pointerId) return;
    pointerRef.current = { x: clientX, y: clientY };
    const element = typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(clientX, clientY)
      : null;
    const target = cardDropTarget(element, clientY) ?? columnTargetAtPoint(boardRef.current, clientX, clientY);
    if (sameDropTarget(current.target, target)) return;
    current.target = target;
    setDrag({ ...current });
  };

  React.useEffect(() => {
    const draggingId = drag?.active ? drag.id : null;
    if (!draggingId || typeof window.requestAnimationFrame !== 'function') return;
    let frame = 0;
    const tick = () => {
      const current = dragRef.current;
      const pointer = pointerRef.current;
      if (!current || current.id !== draggingId || !pointer) return;
      scrollBoardAtPointer(pointer.x, pointer.y);
      updateDropTargetAtPoint(current.pointerId, pointer.x, pointer.y);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [drag?.id, drag?.active]);

  const setDropTargetFromPointer = (event: React.PointerEvent) => {
    const press = touchPress.current;
    if (press?.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 5) cancelTouch();
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) < 5) return;
    current.active = true;
    event.preventDefault();
    scrollBoardAtPointer(event.clientX, event.clientY);
    updateDropTargetAtPoint(event.pointerId, event.clientX, event.clientY);
    setDrag({ ...current });
  };

  const applyDrop = async (state: DragState) => {
    const target = state.target;
    const moving = byId.get(state.id);
    if (!target || !moving || target.kind === 'card' && target.targetId === moving.id) return;
    const commands: ItemCommand[] = [];
    const targetStatus = target.status;
    if (groupProperty && targetStatus !== effectivePropertyValue(moving, groupProperty, byId)) {
      commands.push({ type: 'update', id: moving.id, patch: groupProperty.id === 'status'
        ? { status: targetStatus } : { properties: { [groupProperty.id]: targetStatus } } });
    }
    if (sort === 'Order' && target.kind === 'card' && target.targetId !== moving.id) {
      const ids = reorderedSiblingIds(items, moving.id, target.targetId, target.position);
      if (ids) commands.push({ type: 'reorder', parentId: moving.parentId, ids });
    }
    if (commands.length === 0 || locked) return;
    setApplying(true);
    try {
      for (const command of commands) await onCommand(command);
    } catch {
      // The parent owns error presentation. A failed drop must not become an unhandled rejection.
    } finally {
      setApplying(false);
    }
  };

  const beginDrag = (event: React.PointerEvent<HTMLElement>, id: string, fontSize: number) => {
    if (locked || event.button !== 0 || dragRef.current) return;
    suppressClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    const state: DragState = {
      id, pointerId: event.pointerId, target: null, active: false,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      left: rect.left, top: rect.top, width: rect.width, height: rect.height, fontSize,
    };
    pointerRef.current = { x: event.clientX, y: event.clientY };
    dragRef.current = state;
    setDrag(state);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const finishDrag = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    cancelTouch();
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (!cancelled) setDropTargetFromPointer(event);
    cancelDrag(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && current.active) void applyDrop(current);
  };

  return (
    <section className="lm-kanban" aria-label="Kanban board">
      <div className="lm-kanban__board" ref={boardRef} role="list" aria-label={groupProperty ? `Items by ${groupProperty.name.toLowerCase()}` : 'Items'}>
        {model.columns.map((column) => (
          <section
            className="lm-kanban__column"
            data-lm-kanban-column="true"
            data-kanban-column={column.status ?? ''}
            key={column.status === null ? 'unset' : `value:${column.status}`}
            aria-label={`${column.label}: ${column.groups.reduce((count, group) => count + group.cards.length, 0)} Items`}
            style={{ '--lm-kanban-column-color': column.color } as React.CSSProperties}
            role="listitem"
          >
            <header className="lm-kanban__column-header">
              <h2>{column.label}</h2><span>{column.groups.reduce((count, group) => count + group.cards.length, 0)}</span>
            </header>
            <div className="lm-kanban__column-dropzone">
              {column.groups.map((group) => (
                <section
                  className="lm-kanban__group"
                  data-lm-kanban-group="true"
                  data-kanban-group={group.key}
                  data-kanban-status={column.status ?? ''}
                  data-kanban-parent={group.parentId ?? ''}
                  key={group.key}
                  aria-label={`${group.parentPath.map((parent) => parent.title).join(' / ') || 'Top level'} group`}
                >
                  <header className="lm-kanban__group-header">
                    <span className="lm-kanban__group-rail" aria-hidden="true" />
                    <span>{group.parentPath.map((parent) => parent.title).join(' / ') || 'Top level'}</span>
                  </header>
                  <div className="lm-kanban__cards">
                    {group.cards.map((card) => {
                      const isDragging = drag?.active && drag.id === card.item.id;
                      const activeDrop = sort === 'Order' && drag?.target?.kind === 'card' && drag.target.targetId === card.item.id && drag.id !== card.item.id && byId.get(drag.id)?.parentId === card.item.parentId;
                      const dropPosition = activeDrop && drag?.target?.kind === 'card' ? drag.target.position : null;
                      return (
                        <article
                          className={`lm-kanban__card${!effectiveIncluded(items, card.item.id) ? ' lm-kanban__card--excluded' : ''}${selectedId === card.item.id ? ' lm-kanban__card--selected' : ''}${isDragging ? ' lm-kanban__card--dragging' : ''}${dropPosition ? ` lm-kanban__card--drop-${dropPosition}` : ''}`}
                          data-lm-kanban-card="true"
                          data-kanban-card={card.item.id}
                          data-kanban-status={column.status ?? ''}
                          key={card.item.id}
                          role="button"
                          tabIndex={0}
                          aria-current={selectedId === card.item.id ? 'true' : undefined}
                          aria-label={`${card.item.title}${groupProperty ? `, ${column.label}` : ''}`}
                          aria-description={onContextMenu ? 'Open details. Right-click or long-press for actions.' : undefined}
                          style={{ '--lm-kanban-card-color': propertyPresentation(card.item, colorProperty, byId).color, '--lm-kanban-card-height': `${card.height}px`, '--lm-kanban-card-font-size': `${card.fontSize}px` } as React.CSSProperties}
                          onPointerDown={event => {
                            pointerType.current = event.pointerType || 'mouse';
                            cancelTouch();
                            if (event.button !== 0) return;
                            suppressClick.current = false;
                            if (event.pointerType === 'touch' && onContextMenu) {
                              touchPress.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY};
                              touchTimer.current = setTimeout(() => {
                                cancelDrag();
                                suppressClick.current = true;
                                onContextMenu(card.item.id, event.clientX, event.clientY);
                              }, 500);
                            }
                            beginDrag(event, card.item.id, card.fontSize);
                          }}
                          onPointerMove={setDropTargetFromPointer}
                          onPointerUp={event => finishDrag(event)}
                          onPointerCancel={event => finishDrag(event, true)}
                          onPointerLeave={cancelTouch}
                          onLostPointerCapture={event => cancelDrag(event.pointerId)}
                          onContextMenu={event => {
                            if (!onContextMenu) return;
                            event.preventDefault(); event.stopPropagation();
                            if (pointerType.current === 'touch') return;
                            cancelDrag();
                            onContextMenu(card.item.id, event.clientX, event.clientY);
                          }}
                          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(card.item.id); }}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (onContextMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
                              event.preventDefault(); event.stopPropagation(); cancelDrag();
                              const rect = event.currentTarget.getBoundingClientRect();
                              onContextMenu(card.item.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
                              return;
                            }
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault(); onSelect(card.item.id);
                            }
                          }}
                        >
                          <span className="lm-kanban__card-title">{card.item.title}</span>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
              {column.groups.length === 0 && <div className="lm-kanban__empty">Drop here</div>}
              {onCreate && <button className="lm-kanban__new" disabled={locked} aria-label={`New item in ${column.label}`} onClick={() => onCreate(focusId, groupProperty ? { [groupProperty.id]: column.status } : {})}>+ New</button>}
            </div>
          </section>
        ))}
      </div>
      {drag?.active && createPortal(<div className="lm-kanban__card lm-kanban__drag-preview" aria-hidden="true"
        style={{ left: drag.left + drag.x - drag.startX, top: drag.top + drag.y - drag.startY,
          width: drag.width, minHeight: drag.height, '--lm-kanban-card-color': byId.has(drag.id) ? propertyPresentation(byId.get(drag.id)!, colorProperty, byId).color : undefined, '--lm-kanban-card-font-size': `${drag.fontSize}px` } as React.CSSProperties}>
        <span className="lm-kanban__card-title">{byId.get(drag.id)?.title}</span>
      </div>, document.body)}
      {model.cards.length === 0 && <p className="lm-kanban__empty-board">{matchingIds ? 'No Items match these filters in this branch.' : showAll ? 'No Items in this branch.' : 'No included Items in this branch.'}</p>}
    </section>
  );
}

export default Kanban;
