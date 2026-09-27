import type { WidgetDefinition } from '../widgets';
import type { Workspace } from '../types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function branchIds(workspace: Workspace, rootId: string): string[] {
  const result: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const item of workspace.dashboard.items) {
      if (item.parentId === id) queue.push(item.id);
    }
  }
  return result;
}

export const branchTools: WidgetDefinition = {
  summary: {
    id: 'branch-tools',
    title: 'Branch tools',
    description: 'Quickly add a child or reset lifecycle and effort assessments in a branch.',
  },
  render(input, workspace) {
    const item = workspace.dashboard.items.find((candidate) => candidate.id === input.itemId);
    if (!item) throw new Error(`No Item with id ${input.itemId}.`);
    const historical = workspace.dashboard.snapshotId !== null;
    return `<style>
body{font:14px system-ui,sans-serif;color:CanvasText;background:Canvas;margin:0;padding:12px}
.row{display:flex;gap:8px;flex-wrap:wrap}input,button{font:inherit;padding:6px 9px}
.note{opacity:.7;margin:0 0 10px}form{display:flex;gap:6px;flex:1}input{min-width:12rem;flex:1}
#result{min-height:1.4em;margin:8px 0 0}
</style>
<p class="note">Branch tools for <strong>${escapeHtml(item.title)}</strong>${historical ? ' in this historical snapshot' : ''}.</p>
<div class="row"><form id="add"><input name="title" maxlength="500" required placeholder="New child title"><button>Add child</button></form>
<button id="reset" type="button">Reset branch</button></div>
<p id="result" role="status" aria-live="polite"></p>
<script>
const result=document.querySelector('#result');
const send=async(action,input)=>{result.textContent='Working…';try{const reply=await window.lifeManager.action(action,input);result.textContent=reply.message||'Done.';return true}catch(error){result.textContent=error instanceof Error?error.message:'Action failed.';return false}};
document.querySelector('#add').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const title=new FormData(form).get('title');if(await send('create-child',{title}))form.reset()});
document.querySelector('#reset').addEventListener('click',()=>send('reset-branch',{}));
</script>`;
  },
  actions: {
    'create-child': {
      input: z.object({ title: z.string().trim().min(1).max(500) }).strict(),
      run(value, context) {
        const { title } = value as { title: string };
        const workspace = context.mutate({
          type: 'create',
          parentId: context.itemId,
          title,
        });
        return {
          message: `Created “${title}”.`,
          result: { revision: workspace.dashboard.revision },
        };
      },
    },
    'reset-branch': {
      input: z.object({}).strict(),
      run(_value, context) {
        const ids = branchIds(context.workspace, context.itemId);
        const workspace = context.mutate({
          type: 'bulk',
          ids,
          patch: { status: 'Later', effortOverride: null },
        });
        return {
          message: `Reset ${ids.length} Item${ids.length === 1 ? '' : 's'} to Later and cleared manual effort.`,
          result: { revision: workspace.dashboard.revision, itemCount: ids.length },
        };
      },
    },
  },
};
import { z } from 'zod';
