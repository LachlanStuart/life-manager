// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceSettingsEditor } from '../ui/WorkspaceSettingsEditor';
import { RootItemsSettings } from '../ui/RootItemsSettings';
import { DEFAULT_WORKSPACE_SETTINGS } from '../src/properties';
import { seedItems } from '../src/domain';

afterEach(cleanup);
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
  expect(save.mock.calls[0]![0].settings.properties[1]).toMatchObject({name:'Customer', defaultValue:null, options:[{label:'Acme'}]});
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
