// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PeriodResetForm } from '../ui/PeriodResetForm';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties';
import { mutateItems, seedItems } from '../src/domain';

afterEach(cleanup);

it('preselects Auto resets and prepares independent property values without applying them', () => {
  const settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  settings.properties.push({ id: 'priority', name: 'Priority', unsetLabel: 'Unset', unsetColor: '#aaaaaa', defaultValue: null,
    options: [{ id: 'high', label: 'High', color: '#aabbcc' }] });
  const items = seedItems().map(item => ({ ...item, status: 'Done', allocationAuto: false, effortOverride: 75, properties: { priority: 'high' } }));
  const onApply = vi.fn();
  const screen = render(<PeriodResetForm items={items} settings={settings} busy={false} onCancel={vi.fn()} onApply={onApply} />);
  expect((screen.getByLabelText('Return effort to Auto') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Return importance to Auto') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Set Status to') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Status reset value') as HTMLSelectElement).value).toBe('Later');
  expect(screen.getByRole('option', { name: 'Later (default)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Unset (default)' })).toBeTruthy(); // The custom Priority property retains explicit Unset.
  fireEvent.click(screen.getByLabelText('Return importance to Auto'));
  fireEvent.click(screen.getByLabelText('Set Status to'));
  fireEvent.change(screen.getByLabelText('Status reset value'), { target: { value: 'Now' } });
  fireEvent.click(screen.getByLabelText('Set Priority to'));
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply resets to 4 Items' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith({ type: 'bulk', ids: items.map(item => item.id),
    patch: { effortOverride: null, status: 'Now', properties: { priority: null } } });
  const result = mutateItems(items, onApply.mock.calls[0]![0], settings);
  expect(result.every(item => item.effortOverride === null && item.status === 'Now' && item.properties?.priority === null && !item.allocationAuto)).toBe(true);
});

it('disables confirmation when nothing changes, including an empty workspace', () => {
  const props = { settings: DEFAULT_WORKSPACE_SETTINGS, busy: false, onCancel: vi.fn(), onApply: vi.fn() };
  const screen = render(<PeriodResetForm {...props} items={seedItems()} />);
  expect((screen.getByRole('button', { name: 'Apply resets to 0 Items' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Set Status to'));
  expect((screen.getByRole('button', { name: 'Apply resets to 0 Items' }) as HTMLButtonElement).disabled).toBe(true);
  screen.rerender(<PeriodResetForm {...props} items={[]} />);
  fireEvent.submit(screen.getByRole('button', { name: 'Apply resets to 0 Items' }).closest('form')!);
  expect(props.onApply).not.toHaveBeenCalled();
});
