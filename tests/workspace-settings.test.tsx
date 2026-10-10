// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSettingsEditor } from '../ui/WorkspaceSettingsEditor';
import { RootItemsSettings } from '../ui/RootItemsSettings';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties';
import { seedItems } from '../src/domain';
import { PROPERTY_COLORS } from '../ui/property-colors';

afterEach(cleanup);
it('explicitly converts existing Unset values and separates the workspace fallback from creation defaults', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={DEFAULT_WORKSPACE_SETTINGS} items={seedItems().map(item => ({...item, status: null}))} onSave={save} />);
  fireEvent.click(screen.getByText('Status', {selector: 'summary'}));
  fireEvent.click(screen.getByRole('button', {name: 'Replace Unset with Inherit'}));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('current Items will inherit when saved');
  expect(screen.getByRole<HTMLSelectElement>('combobox', {name: 'Status default for new Items'}).value).toBe('Later');
  fireEvent.change(screen.getByLabelText('Status workspace default'), {target: {value: 'Now'}});
  expect(screen.queryByLabelText('Status Inherit show by default')).toBeNull();
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0].settings.properties[0]).toMatchObject({inheritFromParent: true, defaultValue: 'Later', fallbackValue: 'Now'});
});

it('requires another workspace default when its option is removed', async () => {
  const settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS);
  Object.assign(settings.properties[0]!, {inheritFromParent: true, fallbackValue: 'Later'});
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={settings} items={[]} onSave={save} />);
  fireEvent.click(screen.getByText('Status', {selector: 'summary'}));
  fireEvent.click(screen.getByLabelText('Remove Later'));
  fireEvent.click(screen.getByText('Save workspace'));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Choose a workspace default');
  fireEvent.change(screen.getByLabelText('Status workspace default'), {target: {value: 'Now'}});
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0].settings.properties[0]).toMatchObject({defaultValue: null, fallbackValue: 'Now'});
});
it('saves option and Unset default visibility separately from the creation default', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={DEFAULT_WORKSPACE_SETTINGS} items={[]} onSave={save} />);
  fireEvent.click(screen.getByText('Status', {selector: 'summary'}));
  expect((screen.getByLabelText('Status Done show by default') as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText('Status Done show by default'));
  fireEvent.change(screen.getByLabelText('Status default for new Items'), {target: {value: ''}});
  fireEvent.click(screen.getByLabelText('Status No status show by default'));
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const property = save.mock.calls[0]![0].settings.properties[0];
  expect(property).toMatchObject({defaultValue: null, unsetShowByDefault: false});
  expect(property.options.find((option: {id: string}) => option.id === 'Done').showByDefault).toBe(false);
});
it('adds a property without invalid empty replacement maps and keeps its editor open while typing', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={DEFAULT_WORKSPACE_SETTINGS} items={seedItems()} onSave={save} />);
  fireEvent.click(screen.getByText('+ Property'));
  const input = screen.getByLabelText('Property name 2');
  expect(input.closest('details')!.open).toBe(true);
  fireEvent.change(input, {target: {value: 'Customer'}});
  expect(input.closest('details')!.open).toBe(true);
  fireEvent.click(screen.getAllByText('+ Option')[1]!);
  fireEvent.change(screen.getByLabelText('Customer option 1'), {target: {value: 'Acme'}});
  fireEvent.change(screen.getByLabelText('Workspace name'), {target:{value:' Studio '}});
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0].settings.name).toBe('Studio');
  expect(save.mock.calls[0]![0].replacements).toEqual({});
  expect(save.mock.calls[0]![0].settings.properties[1]).toMatchObject({name:'Customer', inheritFromParent: true, defaultValue:null, options:[{label:'Acme'}]});
  expect(save.mock.calls[0]![0].settings.properties[1].fallbackValue).toBe(save.mock.calls[0]![0].settings.properties[1].options[0].id);
});
it('assigns distinct palette defaults and reuses a freed color after removing an option', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={DEFAULT_WORKSPACE_SETTINGS} items={[]} onSave={save} />);
  fireEvent.click(screen.getByText('+ Property'));
  fireEvent.change(screen.getByLabelText('Property name 2'), {target: {value: 'Priority'}});
  const property = within(screen.getByLabelText('Property name 2').closest('details')!);
  for (const [index, label] of ['High', 'Medium', 'Low'].entries()) {
    fireEvent.click(property.getByText('+ Option'));
    fireEvent.change(property.getByLabelText(`Priority option ${index + 1}`), {target: {value: label}});
  }
  const mediumColor = property.getByLabelText('Medium color').title;
  fireEvent.click(property.getByLabelText('Remove Medium'));
  fireEvent.click(property.getByText('+ Option'));
  fireEvent.change(property.getByLabelText('Priority option 3'), {target: {value: 'Replacement'}});
  expect(property.getByLabelText('Replacement color').title.split(': ')[1]).toBe(mediumColor.split(': ')[1]);
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const saved = save.mock.calls[0]![0].settings.properties[1];
  const colors = [saved.unsetColor, ...saved.options.map((option: {color: string}) => option.color)];
  expect(new Set(colors).size).toBe(4);
  for (const color of colors) expect(PROPERTY_COLORS.some(entry => entry.value === color)).toBe(true);
});
it('saves palette selections and custom colors without submitting when a swatch is clicked', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={DEFAULT_WORKSPACE_SETTINGS} items={[]} onSave={save} />);
  fireEvent.click(screen.getByText('Status', {selector: 'summary'}));
  const trigger = screen.getByRole('button', {name: 'Now color'});
  fireEvent.click(trigger);
  const popup = screen.getByRole('dialog', {name: 'Now color'});
  expect(within(popup).getByRole('button', {name: 'Orange'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(popup).getByRole('button', {name: 'Purple'}));
  expect(screen.queryByRole('dialog', {name: 'Now color'})).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Status unset color'}));
  fireEvent.change(screen.getByLabelText('Status unset color custom color'), {target: {value: '#123456'}});
  fireEvent.click(screen.getByRole('button', {name: 'Close color picker'}));
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0].settings.properties[0]).toMatchObject({
    unsetColor: '#123456', options: expect.arrayContaining([{...DEFAULT_WORKSPACE_SETTINGS.properties[0]!.options[0], color: '#9381ad'}]),
  });
});
it('dismisses the palette with Escape or an outside click and respects disabled settings', () => {
  const props = {settings: DEFAULT_WORKSPACE_SETTINGS, items: [], onSave: vi.fn()};
  const {rerender} = render(<WorkspaceSettingsEditor {...props} />);
  fireEvent.click(screen.getByText('Status', {selector: 'summary'}));
  const trigger = screen.getByRole('button', {name: 'Now color'});
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('dialog', {name: 'Now color'}), {key: 'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByLabelText('Workspace name'));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  rerender(<WorkspaceSettingsEditor {...props} disabled />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  expect(props.onSave).not.toHaveBeenCalled();
});
it('offers reassignment when removing an in-use option and validates unfinished configuration', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WorkspaceSettingsEditor settings={DEFAULT_WORKSPACE_SETTINGS} items={seedItems()} onSave={save} />);
  fireEvent.click(screen.getByText('Status', {selector:'summary'}));
  fireEvent.click(screen.getByLabelText('Remove Later'));
  fireEvent.change(screen.getByLabelText('Replace Status: Later'), {target:{value:'Now'}});
  fireEvent.click(screen.getByText('Save workspace'));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({replacements:{status:{Later:'Now'}}});
  fireEvent.change(screen.getByLabelText('Workspace name'), {target:{value:''}});
  fireEvent.click(screen.getByText('Save workspace'));
  await screen.findByRole('alert');
  expect(save).toHaveBeenCalledOnce();
});
it('cancels root renaming with Escape and appends a new ordinary root Item', async () => {
  const command = vi.fn().mockResolvedValue(undefined);
  render(<RootItemsSettings items={seedItems()} disabled={false} onCommand={command} onOpen={vi.fn()} />);
  const input = screen.getByLabelText('Rename Tend');
  input.focus(); fireEvent.change(input, {target:{value:'Changed'}}); fireEvent.keyDown(input, {key:'Escape'});
  expect(command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('New top-level Item'), {target:{value:'Customers'}});
  fireEvent.click(screen.getByText('Add'));
  await waitFor(() => expect(command).toHaveBeenCalledWith({type:'create', parentId:null, title:'Customers'}));
});
