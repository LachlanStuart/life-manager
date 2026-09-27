import { execFile } from 'node:child_process';

import { z } from 'zod';

import type { LifeManagerActions, WidgetRegistrySurface } from './rpc.js';
import type {
  WidgetActionInput,
  WidgetActionResult,
  WidgetRenderInput,
  WidgetRenderResult,
  WidgetSummary,
  Workspace,
} from './types.js';

const MAX_COMMAND_OUTPUT = 64 * 1024;

export interface WidgetActionContext {
  workspace: Workspace;
  itemId: string;
  snapshotId?: string;
  config: Record<string, unknown>;
  mutate(command: Parameters<LifeManagerActions['mutate']>[0]['command']): Workspace;
  /**
   * Runs a command chosen by trusted widget code. A historical widget must use a
   * separately designed action instead of causing an external side effect.
   */
  runCommand(file: string, args: readonly string[]): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export interface WidgetDefinition {
  summary: WidgetSummary;
  render(input: WidgetRenderInput, workspace: Workspace): string | Promise<string>;
  actions: Record<string, {
    input: z.ZodType;
    run(input: unknown, context: WidgetActionContext): WidgetActionResult | Promise<WidgetActionResult>;
  }>;
}

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

function execute(file: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  if (!file || file.includes('\0')) throw new Error('Widget command executable is invalid.');
  if (args.length > 128 || args.some((arg) => arg.includes('\0'))) {
    throw new Error('Widget command arguments are invalid.');
  }
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { encoding: 'utf8', timeout: 30_000, maxBuffer: MAX_COMMAND_OUTPUT },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`Widget command failed: ${detail}`));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
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

export function createWidgetRegistry(
  actions: LifeManagerActions,
  definitions: readonly WidgetDefinition[] = [branchTools],
): WidgetRegistrySurface {
  const registry = new Map(definitions.map((definition) => [definition.summary.id, definition]));
  if (registry.size !== definitions.length) throw new Error('Widget ids must be unique.');

  const get = (id: string) => {
    const definition = registry.get(id);
    if (!definition) throw new Error(`No widget with id ${id}.`);
    return definition;
  };

  const resolveWorkspace = (input: WidgetRenderInput) => {
    const workspace = actions.workspace(
      input.snapshotId ? { snapshotId: input.snapshotId } : {},
    );
    if (!workspace.dashboard.items.some((item) => item.id === input.itemId)) {
      throw new Error(`No Item with id ${input.itemId}.`);
    }
    return workspace;
  };

  return {
    summaries() {
      return definitions.map(({ summary }) => ({ ...summary }));
    },
    async render(input): Promise<WidgetRenderResult> {
      const definition = get(input.widgetId);
      return { html: await definition.render(input, resolveWorkspace(input)) };
    },
    async action(input: WidgetActionInput): Promise<WidgetActionResult> {
      const definition = get(input.widgetId);
      const action = definition.actions[input.action];
      if (!action) throw new Error(`Widget ${input.widgetId} has no action ${input.action}.`);
      const workspace = resolveWorkspace(input);
      const parsed = action.input.parse(input.input ?? {});
      let actionWorkspace = workspace;
      const context: WidgetActionContext = {
        get workspace() {
          return actionWorkspace;
        },
        itemId: input.itemId,
        snapshotId: input.snapshotId,
        config: input.config ?? {},
        mutate(command) {
          actionWorkspace = actions.mutate({
            snapshotId: input.snapshotId,
            expectedRevision: actionWorkspace.dashboard.revision,
            command,
          });
          return actionWorkspace;
        },
        async runCommand(file, args) {
          if (input.snapshotId) {
            throw new Error('External commands are disabled while viewing historical snapshots.');
          }
          return execute(file, args);
        },
      };
      return action.run(parsed, context);
    },
  };
}
