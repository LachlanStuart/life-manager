import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import {
  computeEfforts,
  siblingShares,
  allocationLimit,
  mutateItems,
} from '../src/domain';
import type { Item, Status } from '../src/types';
import type { SunburstProps } from './contracts';
import { DEFAULT_SUNBURST_DISPLAY, useSunburstDisplay, type SunburstDisplay } from './sunburst-display';
import { viewComparator } from './view-sort';
import './sunburst.css';

const TAU = Math.PI * 2;
const VIEW_SIZE = 1000;
const CENTER = VIEW_SIZE / 2;
const OUTER_RADIUS = 468;
const MAX_VISIBLE_DEPTH = 7;
const MIN_SHARE = 0.1;

export interface SunburstSegment {
  id: string;
  parentId: string | null;
  title: string;
  status: Status;
  included: boolean;
  depth: number;
  startAngle: number;
  endAngle: number;
  parentStartAngle: number;
  parentEndAngle: number;
  innerRadius: number;
  outerRadius: number;
  displayShare: number;
  actualShare: number;
  precedingShare: number;
  followingShare: number;
  effort: number;
  hasDeeperChildren: boolean;
  hasVisibleChildren: boolean;
  siblingCount: number;
  isLastSibling: boolean;
}

export interface SunburstLayoutOptions {
  focusId: string | null;
  showAll: boolean;
  efforts: Readonly<Record<string, number>>;
  compareItems?: (a: Item, b: Item) => number;
  maxDepth?: number;
  innerRadius?: number;
  outerRadius?: number;
  ringWeights?: readonly number[];
  minFirstRingWidth?: number;
}

interface LayoutEntry {
  item: Item;
  depth: number;
  startAngle: number;
  endAngle: number;
  parentStartAngle: number;
  parentEndAngle: number;
  siblingCount: number;
  isLastSibling: boolean;
  precedingShare: number;
  followingShare: number;
}

interface DragState {
  id: string;
  kind: 'Importance' | 'Effort';
  pointerId: number;
  initialValue: number;
  initialRadius: number;
  lastAngle: number;
  angularDelta: number;
  span: number;
  thickness: number;
  value: number;
  initialX: number;
  initialY: number;
  moved: boolean;
}

export interface EffortLayers {
  base: number;
  excess: number;
  displayed: number;
  actual: number;
}

/** Convert uncapped effort into the two radial layers described by the PRD. */
export function effortLayers(effort: number): EffortLayers {
  const actual = Number.isFinite(effort) ? Math.max(0, effort) : 0;
  return {
    base: Math.min(actual, 100) / 100,
    excess: Math.min(Math.max(actual - 100, 0), 90) / 100,
    displayed: Math.min(actual, 190),
    actual,
  };
}

/** Virtual displacement follows the original Item, including the last sibling. */
export function shareForDisplacement(initialShare: number, angularDelta: number, parentSpan: number) {
  return clampShare(initialShare + angularDelta / parentSpan * 100);
}

function polar(radius: number, angle: number, cx = CENTER, cy = CENTER) {
  return {
    x: cx + radius * Math.sin(angle),
    y: cy - radius * Math.cos(angle),
  };
}

/** Stable SVG path generation, including the single-child near-full-circle case. */
export function annularSectorPath(
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
  angularGap = 0,
  radialGap = 0,
): string {
  if (outerRadius <= innerRadius || endAngle <= startAngle) return '';
  const span = endAngle - startAngle;
  const gap = Math.min(Math.max(0, angularGap), span * 0.22);
  const start = startAngle + gap;
  const end = Math.min(endAngle - gap, start + TAU - 0.00001);
  const inner = Math.max(0, innerRadius + radialGap);
  const outer = Math.max(inner, outerRadius - radialGap);
  if (end <= start || outer <= inner) return '';
  const a = polar(outer, start);
  const b = polar(outer, end);
  const c = polar(inner, end);
  const d = polar(inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  if (inner < 0.01) {
    return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${CENTER} ${CENTER} Z`;
  }
  return [
    `M ${a.x} ${a.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y}`,
    `L ${c.x} ${c.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y}`,
    'Z',
  ].join(' ');
}

function makeChildMap(items: Item[], compare = viewComparator(items)): Map<string | null, Item[]> {
  const map = new Map<string | null, Item[]>();
  for (const item of items) {
    const siblings = map.get(item.parentId) ?? [];
    siblings.push(item);
    map.set(item.parentId, siblings);
  }
  for (const siblings of map.values()) {
    siblings.sort(compare);
  }
  return map;
}

/**
 * Pure layout used by the component and tests. Geometry is capped by depth;
 * users reach omitted descendants by focusing an ancestor.
 */
export function buildSunburstLayout(
  items: Item[],
  options: SunburstLayoutOptions,
): SunburstSegment[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const focus = options.focusId === null ? null : itemById.get(options.focusId) ?? null;
  const childMap = makeChildMap(items, options.compareItems);
  const maxDepth = Math.max(1, options.maxDepth ?? MAX_VISIBLE_DEPTH);
  const innerRadius = options.innerRadius ?? (focus ? 104 : 0);
  const outerRadius = options.outerRadius ?? OUTER_RADIUS;
  const inclusionById = new Map<string, boolean>();
  const shareById = new Map<string, number>();
  const isIncluded = (item: Item): boolean => {
    const cached = inclusionById.get(item.id);
    if (cached !== undefined) return cached;
    const parent = item.parentId === null ? null : itemById.get(item.parentId);
    const included = item.included && (!parent || isIncluded(parent));
    inclusionById.set(item.id, included);
    return included;
  };
  // Project local shares once per sibling group; domain mutations and effort
  // calculation validate the tree, so layout need not repeatedly validate it.
  for (const siblings of childMap.values()) {
    for (const [id, share] of siblingShares(siblings)) shareById.set(id, share);
  }
  const shareOf = (item: Item) => shareById.get(item.id) ?? 0;
  const isDrawn = (item: Item) => options.showAll || isIncluded(item);
  const firstParentId = focus?.id ?? null;
  const roots = (childMap.get(firstParentId) ?? []).filter(isDrawn);
  const queue: LayoutEntry[] = [];

  const enqueueChildren = (
    siblings: Item[],
    depth: number,
    startAngle: number,
    endAngle: number,
  ) => {
    if (siblings.length === 0) return;
    const shares = options.showAll
      ? siblings.map(() => 100 / siblings.length)
      : siblings.map(shareOf);
    const total = shares.reduce((sum, share) => sum + Math.max(0, share), 0) || 100;
    const span = endAngle - startAngle;
    let cursor = startAngle;
    let precedingShare = 0;
    siblings.forEach((item, index) => {
      const normalisedShare = Math.max(0, shares[index] ?? 0) / total * 100;
      const next = index === siblings.length - 1
        ? endAngle
        : cursor + span * (normalisedShare / 100);
      queue.push({
        item,
        depth,
        startAngle: cursor,
        endAngle: next,
        parentStartAngle: startAngle,
        parentEndAngle: endAngle,
        siblingCount: siblings.length,
        isLastSibling: index === siblings.length - 1,
        precedingShare,
        followingShare: Math.max(0, 100 - precedingShare - normalisedShare),
      });
      cursor = next;
      precedingShare += normalisedShare;
    });
  };

  enqueueChildren(roots, 0, 0, TAU);
  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index]!;
    const children = (childMap.get(entry.item.id) ?? []).filter(isDrawn);
    if (entry.depth + 1 < maxDepth) {
      enqueueChildren(children, entry.depth + 1, entry.startAngle, entry.endAngle);
    }
  }
  const displayedDepth = queue.length === 0
    ? 1
    : Math.max(...queue.map((entry) => entry.depth)) + 1;
  const weights = Array.from({ length: displayedDepth }, (_, depth) =>
    Math.max(.2, options.ringWeights?.[depth] ?? DEFAULT_SUNBURST_DISPLAY.ringWeights[depth] ?? 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const available = outerRadius - innerRadius;
  const firstWidth = displayedDepth === 1 ? available : Math.max(available * weights[0]! / totalWeight,
    Math.min(available / 2, options.minFirstRingWidth ?? 0));
  const boundaries = [innerRadius];
  weights.forEach((weight, depth) => boundaries.push(boundaries[boundaries.length - 1]! + (depth === 0 ? firstWidth
    : (available - firstWidth) * weight / (totalWeight - weights[0]!))));
  return queue.map((entry) => {
    const children = (childMap.get(entry.item.id) ?? []).filter(isDrawn);
    return {
      id: entry.item.id,
      parentId: entry.item.parentId,
      title: entry.item.title,
      status: entry.item.status,
      included: isIncluded(entry.item),
      depth: entry.depth,
      startAngle: entry.startAngle,
      endAngle: entry.endAngle,
      parentStartAngle: entry.parentStartAngle,
      parentEndAngle: entry.parentEndAngle,
      innerRadius: boundaries[entry.depth]!,
      outerRadius: children.length === 0 ? outerRadius : boundaries[entry.depth + 1]!,
      displayShare: (entry.endAngle - entry.startAngle) /
        (entry.parentEndAngle - entry.parentStartAngle) * 100,
      actualShare: shareOf(entry.item),
      precedingShare: entry.precedingShare,
      followingShare: entry.followingShare,
      effort: options.efforts[entry.item.id] ?? 0,
      hasVisibleChildren: children.length > 0,
      hasDeeperChildren: entry.depth + 1 >= maxDepth && children.length > 0,
      siblingCount: entry.siblingCount,
      isLastSibling: entry.isLastSibling,
    };
  });
}

function statusClass(status: Status) {
  return `lm-sunburst__segment--${status.toLowerCase()}`;
}

export function segmentLabel(segment: SunburstSegment, display: SunburstDisplay, svgSize: number, compactTopic = false) {
  const angle = (segment.startAngle + segment.endAngle) / 2;
  const scale = VIEW_SIZE / svgSize;
  const padding = (compactTopic ? Math.min(1, display.labelPadding) : display.labelPadding) * scale;
  const thickness = segment.outerRadius - segment.innerRadius;
  const halfSpan = Math.min(Math.PI / 2, (segment.endAngle - segment.startAngle) / 2);
  const radial = display.radialLabels && !compactTopic;
  let fontSize = (compactTopic ? Math.min(11, display.fontSize) : display.fontSize) * scale;
  let radius = (segment.innerRadius + segment.outerRadius) / 2;
  let characterLimit = 0;
  const minimum = Math.min(display.minFontSize * scale, fontSize);
  if (radial) {
    const availableHeight = 2 * (segment.outerRadius - padding) * Math.sin(halfSpan) - padding * 2;
    fontSize = Math.min(fontSize, availableHeight / 1.3);
  } else fontSize = Math.min(fontSize, (thickness - padding * 2) / 1.3);
  if (fontSize < minimum) return null;
  for (;;) {
    const halfHeight = fontSize * .65;
    let width: number;
    if (radial) {
      // Move the label outward until the wedge can fit its height. A slightly
      // smaller font can recover much more title length in a narrow wedge.
      const start = Math.max(segment.innerRadius + padding,
        halfSpan >= Math.PI / 2 ? 0 : (halfHeight + padding) / Math.tan(halfSpan));
      const outerPadding = Math.max(padding, display.outerLabelPadding * scale);
      const end = Math.sqrt(Math.max(0, (segment.outerRadius - outerPadding) ** 2 - halfHeight ** 2));
      width = Math.max(0, end - start);
      radius = end;
    } else {
      const sideLimit = halfSpan >= Math.PI / 2 ? Infinity : (radius - halfHeight) * Math.tan(halfSpan);
      const outerLimit = Math.sqrt(Math.max(0, (segment.outerRadius - padding) ** 2 - (radius + halfHeight) ** 2));
      width = Math.max(0, Math.min(sideLimit, outerLimit) * 2 - padding * 2);
    }
    characterLimit = Math.floor(width / (fontSize * .58));
    if (characterLimit >= Math.min(segment.title.length, 14) || fontSize <= minimum) break;
    fontSize = Math.max(minimum, fontSize - .5 * scale);
  }
  if (characterLimit < Math.min(display.minCharacters, segment.title.length)) return null;
  const title = segment.title.length <= characterLimit ? segment.title
    : `${segment.title.slice(0, characterLimit - 1).trimEnd()}…`;
  let degrees = angle * 180 / Math.PI - (radial ? 90 : 0);
  const flipped = degrees > 90 && degrees <= 270;
  if (flipped) degrees += 180;
  const point = polar(radius, angle);
  return { title, fontSize, radial, textAnchor: radial ? flipped ? 'start' as const : 'end' as const : 'middle' as const,
    transform: `translate(${point.x} ${point.y}) rotate(${degrees})` };
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function clampShare(value: number) {
  return Math.min(100 - MIN_SHARE, Math.max(MIN_SHARE, value));
}

function pointerPosition(event: { clientX: number; clientY: number }, svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  // The SVG is square; account for letterboxing when the height is constrained.
  const size = Math.min(rect.width, rect.height) || VIEW_SIZE;
  const x = (event.clientX - rect.left - rect.width / 2) / size * VIEW_SIZE;
  const y = (event.clientY - rect.top - rect.height / 2) / size * VIEW_SIZE;
  return { angle: Math.atan2(x, -y), radius: Math.hypot(x, y) };
}

export function Sunburst({
  items, selectedId, focusId, showAll, onSelect, onHighlight, onFocus, onAllocate,
  disabled = false, mode = 'Navigate', sort = 'Order', onEffort, onCreate, onContextMenu, onShowHidden, compact = false,
}: SunburstProps) {
  const clipPrefix = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelNavigation = () => { if (navigationTimer.current !== null) clearTimeout(navigationTimer.current); navigationTimer.current = null; };
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchPress = useRef<{ id: number; x: number; y: number } | null>(null);
  const touchSuppressClick = useRef(false);
  const pointerType = useRef('mouse');
  const cancelTouch = () => {
    if (touchTimer.current !== null) clearTimeout(touchTimer.current);
    touchTimer.current = null; touchPress.current = null;
  };
  useEffect(() => () => { cancelNavigation(); cancelTouch(); }, [mode, focusId]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [svgSize, setSvgSize] = useState(650);
  const display = useSunburstDisplay();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [rangePreview, setRangePreview] = useState<{ id: string; share: number } | null>(null);
  const rangeDirty = useRef(false);
  useEffect(() => {
    if (!svgRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSvgSize(Math.min(entry.contentRect.width, entry.contentRect.height) || 650);
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    dragRef.current = null;
    setDrag(null);
    setRangePreview(null);
    setHoveredId(null);
    rangeDirty.current = false;
  }, [mode, focusId, disabled, showAll, sort]);
  const preview = drag?.kind === 'Importance' ? { id: drag.id, share: drag.value } : rangePreview;
  const displayedItems = useMemo(() => {
    if (disabled) return items;
    if (drag?.kind === 'Effort') return items.map((item) => item.id === drag.id
      ? { ...item, effortOverride: drag.value } : item);
    return preview && !showAll
      ? mutateItems(items, { type: 'allocate', id: preview.id, share: preview.share }) : items;
  }, [disabled, drag, items, preview?.id, preview?.share, showAll]);
  // Use committed values while dragging so sorted slices do not jump under the pointer.
  const compareItems = useMemo(() => viewComparator(items, sort), [items, sort]);
  const efforts = useMemo(() => computeEfforts(displayedItems), [displayedItems]);
  const layout = useMemo(() => buildSunburstLayout(displayedItems, {
    focusId, showAll, efforts, compareItems, maxDepth: compact ? 2 : display.maxDepth, ringWeights: display.ringWeights,
    // The compact Topic sectors include the origin rather than reserving a
    // central hole. Keep enough physical space for their short familiar names.
    minFirstRingWidth: focusId === null ? (compact ? 26 : Math.min(11, display.fontSize) * 1.3 + 28) * VIEW_SIZE / svgSize : 0,
  }), [displayedItems, efforts, compareItems, focusId, showAll, display.maxDepth, display.ringWeights, display.fontSize, svgSize, compact]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const focus = focusId === null ? null : itemById.get(focusId) ?? null;
  const parent = focus?.parentId ? itemById.get(focus.parentId) ?? null : null;
  const selected = selectedId === null ? null : itemById.get(selectedId) ?? null;
  const selectedSegment = layout.find((segment) => segment.id === selectedId) ?? null;
  const handleSegment = layout.find(segment => segment.id === (drag?.id ?? hoveredId ?? selectedId)) ?? null;
  const allocationDisabled = disabled || showAll;
  const focusTrail = useMemo(() => {
    const ids = new Set<string>();
    let cursor = focus;
    while (cursor && !ids.has(cursor.id)) {
      ids.add(cursor.id);
      cursor = cursor.parentId ? itemById.get(cursor.parentId) ?? null : null;
    }
    return ids;
  }, [focus, itemById]);
  const overview = useMemo(() => !focus ? [] : buildSunburstLayout(displayedItems, {
    focusId: null, showAll, efforts, compareItems, maxDepth: 3, innerRadius: 52, outerRadius: 460,
  }), [displayedItems, efforts, compareItems, focus, showAll]);
  const zoomOut = () => { if (focus) onFocus(focus.parentId); };
  const activate = (id: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (mode === 'Navigate' || mode === 'Omni' || disabled) {
      if (layout.find(segment => segment.id === id)?.hasVisibleChildren) onFocus(id);
      else onSelect(id);
    }
    else if (mode === 'Create') { if (!disabled) onCreate?.(id); }
    else onHighlight?.(id);
  };
  const handleKey = (event: KeyboardEvent<SVGElement>, segment: SunburstSegment, kind = mode) => {
    if (onContextMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault(); event.stopPropagation(); cancelNavigation();
      const rect = event.currentTarget.getBoundingClientRect();
      onContextMenu(segment.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (event.shiftKey && !compact) onSelect(segment.id); else activate(segment.id);
      return;
    }
    if (disabled) return;
    const step = (event.shiftKey ? 5 : 1) * (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1);
    if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    if (kind === 'Importance' && !allocationDisabled && segment.siblingCount > 1) {
      event.preventDefault();
      onAllocate(segment.id, Math.min(allocationLimit(items, segment.id), clampShare(segment.actualShare + step)));
    } else if (kind === 'Effort' && onEffort) {
      event.preventDefault();
      onEffort(segment.id, Math.max(0, segment.effort + step));
    }
  };
  const beginDrag = (event: PointerEvent<SVGElement>, segment: SunburstSegment, kind: DragState['kind']) => {
    if (event.button !== 0 || dragRef.current || disabled || (kind === 'Importance' && (showAll || segment.siblingCount < 2))) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const position = pointerPosition(event, svg);
    const initialValue = kind === 'Importance' ? segment.actualShare : segment.effort;
    const state: DragState = {
      id: segment.id, kind, pointerId: event.pointerId, initialValue,
      initialRadius: position.radius, lastAngle: position.angle, angularDelta: 0,
      span: segment.parentEndAngle - segment.parentStartAngle,
      thickness: segment.outerRadius - segment.innerRadius, value: initialValue,
      initialX: event.clientX, initialY: event.clientY, moved: false,
    };
    suppressClick.current = true;
    cancelNavigation();
    (onHighlight ?? onSelect)(segment.id);
    svg.setPointerCapture?.(event.pointerId);
    dragRef.current = state;
    setDrag(state);
  };
  const updateDrag = (event: PointerEvent<SVGSVGElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId || disabled) return null;
    const moved = state.moved || Math.hypot(event.clientX - state.initialX, event.clientY - state.initialY) >= 4;
    if (!moved) return state;
    const position = pointerPosition(event, event.currentTarget);
    // Unwrap consecutive angular deltas so crossing noon or a parent edge
    // never changes direction and multiple turns remain continuous.
    const delta = Math.atan2(Math.sin(position.angle - state.lastAngle), Math.cos(position.angle - state.lastAngle));
    const angularDelta = state.angularDelta + delta;
    const value = state.kind === 'Importance'
      ? Math.min(allocationLimit(items, state.id), shareForDisplacement(state.initialValue, angularDelta, state.span))
      : Math.max(0, state.initialValue + (position.radius - state.initialRadius) / state.thickness * 100);
    const next = { ...state, lastAngle: position.angle, angularDelta, value, moved };
    dragRef.current = next;
    setDrag(next);
    return next;
  };
  const commitRange = (id: string, share: number) => {
    if (!rangeDirty.current) return;
    rangeDirty.current = false;
    setRangePreview(null);
    if (!allocationDisabled) onAllocate(id, Math.min(allocationLimit(items, id), share));
  };
  const targetRadius = 22 * VIEW_SIZE / svgSize;
  const omni = mode === 'Omni';
  const handleRadius = omni ? 5 * VIEW_SIZE / svgSize : targetRadius * .75;
  const createRadius = omni ? 6 * VIEW_SIZE / svgSize : targetRadius;
  const createFits = (segment: SunburstSegment) => {
    const radius = (segment.innerRadius + segment.outerRadius) / 2;
    return segment.outerRadius - segment.innerRadius >= targetRadius * 2.1
      && (segment.endAngle - segment.startAngle) * radius >= targetRadius * 2.2;
  };
  const createButton = (id: string, title: string, x: number, y: number) => (
    <g key={`create-${id}`} className="lm-sunburst__create" role="button" tabIndex={0}
      aria-label={`Add child to ${title}`} aria-disabled={disabled}
      transform={`translate(${x} ${y})`}
      onClick={(event) => { event.stopPropagation(); if (!disabled) onCreate?.(id); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); if (!disabled) onCreate?.(id);
        }
      }}>
      <title>{`Add child to ${title}`}</title>
      <circle r={createRadius} />
      <path d={`M ${-createRadius * .45} 0 H ${createRadius * .45} M 0 ${-createRadius * .45} V ${createRadius * .45}`} />
    </g>
  );
  const fallbackCreates = mode === 'Create' ? layout.filter((segment) => !createFits(segment)) : [];

  return (
    <section className="lm-sunburst" aria-label="Intended attention sunburst">
      {focus && !compact && <div className="lm-sunburst__navigation">
        <button aria-label={parent ? `Return to ${parent.title}` : 'Return to overview'} onClick={zoomOut}>↑ {parent?.title ?? 'Life'}</button>
      </div>}
      <div className={`lm-sunburst__stage${layout.length === 0 ? ' lm-sunburst__stage--empty' : ''}`}>
        <svg ref={svgRef}
          className={`lm-sunburst__svg${omni ? ' lm-sunburst__svg--omni' : ''}${drag ? ` lm-sunburst__svg--dragging lm-sunburst__svg--${drag.kind.toLowerCase()}` : ''}`}
          viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} role="tree" aria-hidden={layout.length === 0 || undefined}
          aria-label={focus ? `${focus.title} allocation` : 'Life allocation overview'}
          onPointerMove={event => {
            const press = touchPress.current;
            if (press && press.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) {
              cancelTouch(); touchSuppressClick.current = true;
            }
            updateDrag(event);
          }}
          onPointerLeave={() => { if (touchPress.current) { cancelTouch(); touchSuppressClick.current = true; } if (!dragRef.current) setHoveredId(null); }}
          onPointerUp={(event) => {
            cancelTouch();
            const state = updateDrag(event);
            if (!state) return;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            if (state.moved && state.kind === 'Importance' && !allocationDisabled) onAllocate(state.id, state.value);
            if (state.moved && state.kind === 'Effort' && !disabled) onEffort?.(state.id, state.value);
            dragRef.current = null; setDrag(null);
            window.setTimeout(() => { suppressClick.current = false; }, 0);
          }}
          onPointerCancel={() => { cancelTouch(); touchSuppressClick.current = true; dragRef.current = null; setDrag(null); suppressClick.current = false; }}
          onLostPointerCapture={() => { dragRef.current = null; setDrag(null); }}
        >
          <circle className="lm-sunburst__backdrop" cx={CENTER} cy={CENTER} r={OUTER_RADIUS + 8} />
          {layout.map((segment, segmentIndex) => {
            const layers = effortLayers(segment.effort);
            const label = segmentLabel(segment, compact ? { ...display, fontSize: 10, minFontSize: 8, labelPadding: 1 } : display, svgSize, !focus && segment.depth === 0 && segment.title.length <= 6);
            const labelClip = `${clipPrefix}-slice-${segmentIndex}`;
            const thickness = segment.outerRadius - segment.innerRadius;
            const angularGap = Math.min(0.012, 2.2 / Math.max(1, segment.innerRadius));
            const selectedClass = segment.id === selectedId ? ' lm-sunburst__segment--selected' : '';
            const ghostClass = !segment.included ? ' lm-sunburst__segment--ghost' : '';
            return (
              <g key={segment.id}
                className={`lm-sunburst__segment ${statusClass(segment.status)}${selectedClass}${ghostClass}`}
                onContextMenu={event => { if (pointerType.current === 'touch' && (mode === 'Navigate' || omni)) { event.preventDefault(); return; } if (onContextMenu) { event.preventDefault(); event.stopPropagation(); cancelNavigation(); onContextMenu(segment.id, event.clientX, event.clientY); } }}
                role="treeitem" tabIndex={0}
                aria-label={`${segment.title}, ${segment.status}, ${formatPercent(segment.actualShare)} share, ${formatPercent(layers.actual)} effort${segment.included ? '' : ', excluded'}`}
                aria-selected={segment.id === selectedId}
                aria-description={segment.hasVisibleChildren ? 'Zoom into branch. Long-press or double-click to open details.' : 'Open details.'}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch' && !dragRef.current) setHoveredId(segment.id); }}
                onPointerDown={(event) => {
                  pointerType.current = event.pointerType || 'mouse';
                  touchSuppressClick.current = false;
                  cancelTouch();
                  if (event.pointerType === 'touch' && (mode === 'Navigate' || omni)) {
                    cancelNavigation();
                    touchPress.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                    touchTimer.current = setTimeout(() => {
                      touchSuppressClick.current = true;
                      cancelTouch();
                      onSelect(segment.id);
                    }, 500);
                  }
                  if (mode === 'Importance' || (mode === 'Effort' && onEffort)) beginDrag(event, segment, mode);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (touchSuppressClick.current) { touchSuppressClick.current = false; return; }
                  if (!compact && (mode === 'Navigate' || omni) && pointerType.current !== 'touch' && event.detail > 0 && !suppressClick.current) {
                    cancelNavigation();
                    if (event.detail === 1) navigationTimer.current = setTimeout(() => { navigationTimer.current = null; activate(segment.id); }, 400);
                  } else activate(segment.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation(); cancelNavigation(); cancelTouch();
                  if (!compact && pointerType.current !== 'touch' && (mode === 'Navigate' || omni)) onSelect(segment.id);
                }}
                onKeyDown={(event) => handleKey(event, segment)}>
                <title>{`${segment.title}\n${segment.status} · ${formatPercent(segment.actualShare)} intended share · ${formatPercent(layers.actual)} effort${segment.included ? '' : '\nExcluded — temporary Show all geometry'}`}</title>
                <path className="lm-sunburst__sector"
                  d={annularSectorPath(segment.startAngle, segment.endAngle, segment.innerRadius, segment.outerRadius, angularGap, 1.5)} />
                {layers.base > 0 && <path className="lm-sunburst__effort lm-sunburst__effort--base"
                  d={annularSectorPath(segment.startAngle, segment.endAngle, segment.innerRadius, segment.innerRadius + thickness * layers.base, angularGap, 2.3)} />}
                {layers.excess > 0 && <path className="lm-sunburst__effort lm-sunburst__effort--excess"
                  d={annularSectorPath(segment.startAngle, segment.endAngle, segment.innerRadius, segment.innerRadius + thickness * layers.excess, angularGap, 3.1)} />}
                {label && <g clipPath={`url(#${labelClip})`} aria-hidden="true">
                  <defs><clipPath id={labelClip}><path d={annularSectorPath(
                    segment.startAngle, segment.endAngle, segment.innerRadius, segment.outerRadius, angularGap, 4,
                  )} /></clipPath></defs>
                  {segment.hasVisibleChildren && !compact && label.fontSize * svgSize / VIEW_SIZE >= 8 && <text
                    className="lm-sunburst__branch-hint" textAnchor={label.textAnchor} transform={label.transform}
                    style={{ fontSize: label.fontSize * .8 }}><tspan x="0" y={-label.fontSize * .8}>›</tspan></text>}
                  <text className="lm-sunburst__label" data-orientation={label.radial ? 'radial' : 'tangential'} textAnchor={label.textAnchor}
                    transform={label.transform} style={{ fontSize: label.fontSize }}>
                    <tspan x="0" y={label.fontSize * .35}>{label.title}</tspan>
                  </text>
                </g>}
              </g>
            );
          })}
          {(omni ? layout : handleSegment ? [handleSegment] : []).map(segment => {
            const layers = effortLayers(segment.effort);
            const thickness = segment.outerRadius - segment.innerRadius;
            const middleAngle = (segment.startAngle + segment.endAngle) / 2;
            return <g key={`controls-${segment.id}`}>
                {(mode === 'Importance' || omni) && !allocationDisabled && segment.siblingCount > 1 && <g>
                  {!omni && <path className="lm-sunburst__resize-guide"
                    d={`M ${polar(segment.innerRadius + 4, segment.endAngle).x} ${polar(segment.innerRadius + 4, segment.endAngle).y} L ${polar(segment.outerRadius - 4, segment.endAngle).x} ${polar(segment.outerRadius - 4, segment.endAngle).y}`} />}
                  <circle className="lm-sunburst__resize-handle" data-item-id={segment.id}
                    cx={polar((segment.innerRadius + segment.outerRadius) / 2, segment.endAngle).x}
                    cy={polar((segment.innerRadius + segment.outerRadius) / 2, segment.endAngle).y}
                    r={handleRadius} role="slider" tabIndex={0}
                    aria-label={`Drag importance for ${segment.title}`} aria-valuemin={MIN_SHARE} aria-valuemax={99.9} aria-valuenow={segment.actualShare}
                    onKeyDown={event => handleKey(event, segment, 'Importance')}
                    onPointerDown={(event) => beginDrag(event, segment, 'Importance')}><title>{`Drag importance for ${segment.title}`}</title></circle>
                </g>}
                {(mode === 'Effort' || omni) && !disabled && onEffort && <g>
                  {!omni && <path className="lm-sunburst__radial-guide"
                    d={`M ${polar(segment.innerRadius + 8, middleAngle).x} ${polar(segment.innerRadius + 8, middleAngle).y} L ${polar(segment.outerRadius - 8, middleAngle).x} ${polar(segment.outerRadius - 8, middleAngle).y}`} />}
                  <circle className="lm-sunburst__effort-handle" data-item-id={segment.id}
                    cx={polar(segment.innerRadius + thickness * Math.max(.12, Math.min(.88, layers.base)), middleAngle).x}
                    cy={polar(segment.innerRadius + thickness * Math.max(.12, Math.min(.88, layers.base)), middleAngle).y}
                    r={handleRadius} role="slider" tabIndex={0} aria-label={`Drag effort for ${segment.title}`}
                    aria-valuemin={0} aria-valuemax={Math.max(200, Math.ceil(segment.effort))} aria-valuenow={segment.effort}
                    onKeyDown={event => handleKey(event, segment, 'Effort')}
                    onPointerDown={(event) => beginDrag(event, segment, 'Effort')}><title>{`Drag effort for ${segment.title}`}</title></circle>
                </g>}
            </g>;
          })}
          {focus && <g className="lm-sunburst__center lm-sunburst__center--zoomed"
            role={focus ? 'button' : undefined} tabIndex={focus ? 0 : undefined}
            aria-label={`Open ${focus.title} details`}
            onClick={(event) => { event.stopPropagation(); onSelect(focus.id); }} onDoubleClick={(event) => { event.stopPropagation(); }}
            onKeyDown={(event) => { if (focus && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect(focus.id); } }}>
            <circle cx={CENTER} cy={CENTER} r={focus ? 94 : 46} />
            <text x={CENTER} y={CENTER + (focus ? mode === 'Create' ? -64 : -12 : 8)} textAnchor="middle">
              <tspan className="lm-sunburst__center-title" x={CENTER}>{focus?.title.length && focus.title.length > 14 ? `${focus.title.slice(0, 13)}…` : focus?.title ?? 'Life'}</tspan>
              {focus && <tspan className="lm-sunburst__center-hint" x={CENTER} dy="29">Open details</tspan>}
            </text>
          </g>}
          {(mode === 'Create' || (omni && !disabled)) && layout.filter(segment => omni || createFits(segment)).map((segment) => {
            const middle = (segment.startAngle + segment.endAngle) / 2;
            const angle = omni ? middle - Math.min((segment.endAngle - segment.startAngle) / 4, createRadius * 2.5 / segment.outerRadius) : middle;
            const point = polar(segment.outerRadius - createRadius * 1.2, angle);
            return createButton(segment.id, segment.title, point.x, point.y);
          })}
          {(mode === 'Create' || (omni && !disabled)) && focus && createButton(focus.id, focus.title, CENTER, CENTER + (omni ? 52 : 28))}
          {focus && !compact && <g className="lm-sunburst__minimap" role="button" tabIndex={0}
            aria-label="Return to full overview" onClick={() => onFocus(null)}
            onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onFocus(null); } }}
            transform="translate(24 24) scale(.14)">
            <circle className="lm-sunburst__minimap-bg" cx={CENTER} cy={CENTER} r="488" />
            {overview.map((segment) => <path key={segment.id}
              className={`lm-sunburst__minimap-sector ${statusClass(segment.status)}${focusTrail.has(segment.id) ? ' lm-sunburst__minimap-sector--focus' : ''}${!segment.included ? ' lm-sunburst__segment--ghost' : ''}`}
              d={annularSectorPath(segment.startAngle, segment.endAngle, segment.innerRadius, segment.outerRadius, .018, 4)} />)}
            <circle className="lm-sunburst__minimap-center" cx={CENTER} cy={CENTER} r="48" />
          </g>}
        </svg>
        {drag && <output className="lm-sunburst__live" aria-live="polite">
          <span>{itemById.get(drag.id)?.title} · {drag.kind === 'Importance' ? 'Importance' : 'Effort'}</span>
          <strong>{formatPercent(drag.value)}</strong>
        </output>}
        {layout.length === 0 && <div className="lm-sunburst__empty">
          <strong>{focus?.title ?? 'Life'}</strong>
          <span role="status">{items.some(item => item.parentId === (focus?.id ?? null)) ? 'No included children' : focus ? 'No children yet' : 'No Items yet'}</span>
          <div className="lm-sunburst__empty-actions">
            {focus && <button onClick={() => onSelect(focus.id)}>Open details</button>}
            {focus && !disabled && onCreate && <button onClick={() => onCreate(focus.id)}>+ Add child</button>}
            {!showAll && onShowHidden && items.some(item => item.parentId === (focus?.id ?? null)) && <button onClick={onShowHidden}>Show hidden children</button>}
          </div>
        </div>}
      </div>
      {fallbackCreates.length > 0 && <div className="lm-sunburst__create-list" aria-label="Add children to small slices">
        {fallbackCreates.map((segment) => <button key={segment.id} type="button" disabled={disabled}
          aria-label={`Add child to ${segment.title}`} onClick={() => onCreate?.(segment.id)}><span aria-hidden="true">＋</span> {segment.title}</button>)}
      </div>}
      {mode === 'Importance' && selected && selectedSegment && <div className="lm-sunburst__allocation" aria-label={`Allocation for ${selected.title}`}>
        <div><strong>{selected.title}</strong></div>
        <input type="range" min={0} max={Math.min(99.9, allocationLimit(items, selected.id))} step="any"
          value={rangePreview?.id === selected.id ? rangePreview.share : selectedSegment.actualShare}
          disabled={allocationDisabled || selectedSegment.siblingCount < 2} aria-label={`Intended share for ${selected.title}`}
          aria-describedby={showAll ? "lm-sunburst-allocation-help" : undefined}
          onChange={(event) => { if (!allocationDisabled && selectedSegment.siblingCount >= 2) {
            rangeDirty.current = true; setRangePreview({ id: selected.id, share: Number(event.currentTarget.value) });
          } }}
          onPointerUp={(event) => commitRange(selected.id, Number(event.currentTarget.value))}
          onKeyUp={(event) => commitRange(selected.id, Number(event.currentTarget.value))}
          onBlur={(event) => commitRange(selected.id, Number(event.currentTarget.value))} />
        <output>{formatPercent(selectedSegment.actualShare)}</output>
        {showAll && <span id="lm-sunburst-allocation-help" className="lm-sunburst__allocation-help">Turn off Show all to adjust importance.</span>}
      </div>}
      {mode === 'Effort' && selected && selectedSegment && <div className="lm-sunburst__effort-readout">
        <span><strong>{selected.title}</strong> · Effort</span><output>{formatPercent(selectedSegment.effort)}</output>
      </div>}
    </section>
  );
}

export default Sunburst;
