// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreateItemForm } from '../ui/CreateItemForm';
import { seedItems } from '../src/domain';
import type { Item } from '../src/types';

afterEach(cleanup);
const root = seedItems()[0]!;
const child: Item = { ...root, id: 'child', parentId: root.id, title: 'Child' };
function setup() {
  const onCreate = vi.fn();
  render(<CreateItemForm items={[root, child]} parentId={root.id} disabled={false} onCancel={vi.fn()} onCreate={onCreate} />);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New task' } });
  return onCreate;
}
it('creates with blank importance and calculated effort using the shared controls', () => {
  const create = setup();
  const allocation = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Intended attention percent' });
  expect(allocation.value).toBe(''); expect(allocation.placeholder).toBe('50'); expect(allocation.required).toBe(false);
  fireEvent.change(screen.getByLabelText('Lifecycle status'), { target: { value: 'Now' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Item' }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'create', title: 'New task', share: null, patch: { status: 'Now', included: true, effortOverride: null } }));
});
it('accepts explicit importance and effort and can right-click importance back to blank', () => {
  const create = setup();
  const allocation = screen.getByLabelText('Intended attention percent');
  const effort = screen.getByLabelText('Manual effort percent');
  for (const [input, value] of [[allocation, '30'], [effort, '120']] as const) {
    fireEvent.focus(input); fireEvent.change(input, { target: { value } }); fireEvent.blur(input);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create Item' }));
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ share: 30, patch: expect.objectContaining({ effortOverride: 120 }) }));
  fireEvent.contextMenu(allocation);
  fireEvent.click(screen.getByRole('button', { name: 'Create Item' }));
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ share: null }));
});
