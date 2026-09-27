import { branchTools } from './plugins/branch-tools';
export { branchTools } from './plugins/branch-tools';
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
