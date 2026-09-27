import type { SqlJsStatic } from 'sql.js';
import { initializeDatabase, createLifeManagerStore } from '../store';
import { createLifeManagerActions, widgetActionInputSchema, widgetRenderInputSchema } from '../rpc';
import type { MutationInput, PromptTemplate } from '../types';
import { seedDemo } from '../demo-seed';
import { branchTools } from '../plugins/branch-tools';
import { browserSqlite } from './sqlite';
import { readDemo, writeDemo } from './storage';

/** Reload within a cross-tab lock, then persist before returning a successful edit. */
export function createDemoApi(SQL: SqlJsStatic, storage: IDBDatabase,
  lock: <T>(operation: () => Promise<T>) => Promise<T>) {
  return (path: string, input?: unknown): Promise<unknown> => lock(async () => {
    const bytes = await readDemo(storage);
    const database = new SQL.Database(bytes);
    try {
      const db = browserSqlite(database);
      initializeDatabase(db);
      const store = createLifeManagerStore(db);
      if (!bytes) seedDemo(db, store);
      const actions = createLifeManagerActions(store, () => [branchTools.summary]);
      const url = new URL(path, 'https://demo.invalid/');
      let result: unknown;
      let changed = false;
      switch (url.pathname) {
        case '/workspace': result = actions.workspace(url.searchParams.has('snapshotId') ? { snapshotId: url.searchParams.get('snapshotId')! } : {}); break;
        case '/mutate': result = actions.mutate(input as MutationInput); changed = true; break;
        case '/plan': result = actions.plan(input as { expectedRevision?: number }); changed = true; break;
        case '/rollover': result = actions.rollover(input as { name?: string; expectedRevision?: number }); changed = true; break;
        case '/templates': result = actions.listPromptTemplates(); break;
        case '/templates/save': result = actions.savePromptTemplate(input as PromptTemplate); changed = true; break;
        case '/templates/delete': actions.deletePromptTemplate(input as { id: string }); result = { deleted: true }; changed = true; break;
        case '/agent/link': result = { message: 'Agent launch requires the self-hosted app; it is unavailable in this browser demo.' }; break;
        case '/widgets/render':
        case '/widgets/action': {
          const call = url.pathname.endsWith('action') ? widgetActionInputSchema.parse(input) : null;
          const context = call ?? widgetRenderInputSchema.parse(input);
          if (context.widgetId !== branchTools.summary.id) throw new Error('This widget requires the self-hosted app.');
          let workspace = actions.workspace(context.snapshotId ? { snapshotId: context.snapshotId } : {});
          if (!workspace.dashboard.items.some(item => item.id === context.itemId)) throw new Error('Item not found.');
          if (!call) result = { html: await branchTools.render(context, workspace) };
          else {
            if (context.snapshotId) throw new Error('Widget actions are disabled in historical snapshots.');
            const action = branchTools.actions[call.action];
            if (!action) throw new Error('Unknown widget action.');
            result = await action.run(action.input.parse(call.input ?? {}), {
              ...context, config: context.config ?? {},
              get workspace() { return workspace; },
              mutate(command) { workspace = actions.mutate({ command, expectedRevision: workspace.dashboard.revision }); return workspace; },
              async runCommand() { throw new Error('Host commands are unavailable in the browser demo.'); },
            });
            changed = true;
          }
          break;
        }
        default: throw new Error('This browser demo does not provide that operation or data export.');
      }
      if (!bytes || changed) await writeDemo(storage, database.export());
      return result;
    } finally { database.close(); }
  });
}
