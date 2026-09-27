# Life Manager

An ordinary local web app for planning attention across Tend, Build, Learn and Enjoy. [PRD.md](PRD.md) is the canonical product specification and resume document. [PLUGINS-PRD.md](PLUGINS-PRD.md) covers the activity widgets.

## Run

Requires Node 22.12 or newer and npm.

```sh
cd life-manager
npm install
npm run build
npm start
```

Open [localhost:4317](http://localhost:4317). For phone access, use the server's address on a trusted private network, for example through Tailscale. The host and server must remain running. There is no sign-in screen; do not expose the server directly to the public internet.

`npm run demo` starts a separate sample workspace on the same port. It seeds `.demo-data/` once and retains trial edits on subsequent starts. Stop one server before starting another on that port, or choose a different `PORT`. `npm start` uses `.data/`; a fresh data directory starts with the four Topics.

Use the same supported Node version for dependency installation and execution. If changing Node versions causes a native SQLite ABI error, reinstall dependencies under the chosen runtime.

| Setting | Default |
| --- | --- |
| `PORT` | `4317` |
| `HOST` | `0.0.0.0`; use `127.0.0.1` for this computer only |
| `LIFE_MANAGER_DATA_DIR` | `.data/` alongside this README |

The data directory may contain private notes, attachments, snapshots and authorization tokens. Keep it out of source distributions and version control.

Rebuild after frontend changes. `npm run dev` watches server changes; it does not run a separate frontend development server. Runtime data and build outputs are ignored by Git.

## Use

The home URL opens the current full wheel. Omni is the default for desktop mouse use; touch starts in Navigate. In Navigate and Omni, tap/click zooms and long-press/double-click opens details; Importance and Effort allow dragging a slice immediately, and Create adds temporary child buttons. Numeric editing is available in Item details. Show all reveals hidden Items without changing their real allocations.

With a mouse, Omni combines click-to-zoom and double-click-to-open with small persistent controls: white boundary handles adjust importance, green handles adjust effort, and plus buttons add children. Handle drags do not open the Item pane. The separate modes remain available for touch interaction.

The wheel's gear menu adjusts radial titles, font sizes, label padding/truncation, visible depth and relative layer widths. These preferences stay in this browser's local storage; Reset display restores defaults. Narrow slices remain accessible by zooming into their branch.

Switch to **Kanban** for execution. The compact sunburst and branch links filter the board. Upward links lead to Life and ancestors; Open beside the current Item opens its details. Child links show branches that have children. Columns group lifecycle states, and each parent-path heading connects its sibling cards with a subtle rail. Importance controls card height and title size within readable bounds.

Drag anywhere on a title-only card to move it into another status column; the card follows the pointer. Drop before or after a sibling card in the same parent group to also change sibling order; the insertion marker shows when reordering will occur. Other drops never reparent or reorder. A click or tap opens the Item, where status can also be edited. Opening a card uses the usual Item pane, and Back returns to the same board and branch. The view is preserved in links as `?view=kanban`.

Wide windows show a resizable Item pane. Below 1050px an Item occupies the main view, with Children above Notes. Item and wheel-focus URLs participate in browser history. Notes offer rich text and Markdown source editing; a short debounce saves changes, with best-effort flushes on navigation/backgrounding.

The period picker contains Planning → Active → Next. Active captures Planned once. Next opens rollover, which captures Closing and the next Opening without resetting anything. Historical snapshots are read-only until Correct this snapshot is selected; corrections affect only that snapshot.

## Storage

The server uses Node HTTP, SQLite (`better-sqlite3`) and a Vite/React client. MDXEditor is loaded when an Item is opened. Domain calculations are shared with the server; HTTP actions validate inputs and use revision checks to avoid silently applying stale writes.

The database is `life-manager.sqlite` inside the data directory. Managed images live in its `attachments/` directory and use Markdown URLs such as `/attachments/<id>.png`. Images referenced by older snapshots are retained. Back up the database and attachments together; stop the server before making a simple filesystem copy, or use SQLite's backup facilities while it runs.

[src/store.ts](src/store.ts) owns the schema and additive migrations. [src/types.ts](src/types.ts) defines the corresponding application records:

- `items`: `id`, `parent_id`, `sibling_order`, `title`, `status`, Markdown `notes`, `included`, `weight`, `allocation_auto` (default false for existing Items), nullable `effort_override`, nullable `default_prompt_id`, nullable `resource_uri`.
- `prompt_templates`: `id`, `name`, `prompt`. An Item's unset default inherits from its nearest configured ancestor.
- `periods`, `snapshots`, `life_manager_meta`: period boundaries, complete Item snapshots and the current revision. A snapshot stores its Item records as JSON, including notes and hidden Items.

`resource_uri` is a specific saved file/folder reference for the video widget; it is not a generic property system. Prompt defaults and resource references are included in snapshots. Templates are current application configuration; deleting a template clears current defaults without rewriting historical Item records.

Call `initializeDatabase(db)` before `createLifeManagerStore(db)`. New stores seed the Topic IDs `tend`, `build`, `learn`, `enjoy`. There is no built-in importer. Use the shared API or prepare an offline migration into a new data directory when bringing in existing material.

## Shared API

All paths are relative to the running server. POST requests use `Content-Type: application/json` and `X-Life-Manager: 1`. Cross-origin browser actions are rejected. Read endpoints are ordinary GETs.

| Endpoint | Input / result |
| --- | --- |
| `GET /api/workspace` | Current Items, periods, snapshot summaries, widgets and prompt templates. Add `?snapshotId=<id>` for a checkpoint. |
| `GET /api/items/<id>` | Item, immediate children, ancestors, revision and period context. Supports `snapshotId`. |
| `POST /api/mutate` | `{command, expectedRevision?, snapshotId?}`; returns the updated workspace. |
| `POST /api/plan` | `{expectedRevision?}` |
| `POST /api/rollover` | `{name?, expectedRevision?}` |
| `GET /api/export` | Complete current/historical data and templates as JSON. |
| `GET /api/templates` | Saved templates. |
| `POST /api/templates/save` | `{id, name, prompt}` |
| `POST /api/templates/delete` | `{id}` |
| `POST /api/widgets/render` | `{widgetId, itemId, config?, snapshotId?}` → `{html}` |
| `POST /api/widgets/action` | Render context plus `{action, input?}` |
| `POST /api/agent/link` | `{itemId, templateId}` → `{message, url}` containing a prefilled `codex://` link. |
| `POST /api/attachments` | Raw PNG/JPEG/GIF/WebP bytes, image content type and `X-Life-Manager: 1`; returns `{url}`. Maximum 20 MB. |

Commands support create, update, delete, delete-many, move, reorder, allocate and bulk updates. New Items default to automatic allocation unless an explicit `patch.weight` or optional creation `share` is supplied. Creation `share` applies a local percentage atomically with the new Item. `allocate` with `share: null` enables automatic allocation; blanks equally divide the remainder after included explicit shares. With included blanks, manual weights represent percentages; without them, weights retain proportional normalization. The additive optional `allocationAuto` field is retained in checkpoint and export Items (schema version 2); absent means manual, preserving older exports and snapshots. `delete-many` accepts `ids` and removes all selected subtrees atomically while preserving historical snapshots. See [the agent skill](skills/life-manager/SKILL.md) for examples. Revision conflicts return HTTP 409. Other invalid operations return an error string. Browser clients receive change notifications over `/api/events` and refresh current server state.

## Widgets

A fenced block embeds an installed widget and nested configuration:

````markdown
```life-widget
{
  "id": "branch-tools",
  "config": {"example": {"nested": true}}
}
```
````

The visual editor renders the block and provides its configuration text. Source mode always exposes the fence. Malformed/unknown blocks retain editable source.

[src/widgets.ts](src/widgets.ts) contains trusted widget definitions. A definition returns HTML and registers named, validated server actions. The HTML runs in a sandboxed iframe and can call `window.lifeManager.action(name, input)`. Widgets can call `window.lifeManager.refresh()` to request newly rendered HTML; reloading the iframe alone would replay its old document. Its server action receives the owning Item, config, workspace, shared `mutate` operations and a `runCommand(executable, args)` helper. Command definitions are code; the HTTP API does not expose a general shell endpoint. Restart after editing definitions.

The included Branch tools widget demonstrates Item creation and a bulk reset. Activity definitions live in `src/plugins/`. Historical widgets cannot execute host commands, and their UI action bridge is disabled while viewing a snapshot.

### Local videos

The `local-video` block lists only immediate regular files and folders. Dotfiles are omitted. Each widget requires an absolute root directory; no directory names are excluded by default. Set the root and any exact excluded directory names in Markdown:

````markdown
```life-widget
{
  "id": "local-video",
  "config": {
    "root": "/path/to/media",
    "exclude": ["Watched"]
  }
}
```
````

Refresh rereads that one directory. Create Item adds a child of the widget owner, with the file stem or folder name, Later status, inclusion enabled and a saved file URL. A current reference anywhere in the hierarchy suppresses the entry unless all referencing Items are Done or Cut. Hidden Items still count. Folders produce one Item and are never recursively imported. Playback and file moves remain external.

### Twitch

The `twitch-live` widget shows live followed channels. Its Markdown configuration contains only public setup and grouping data:

````markdown
```life-widget
{
  "id": "twitch-live",
  "config": {
    "clientId": "YOUR_PUBLIC_CLIENT_ID",
    "groups": {"example_channel": "Creative"},
    "groupOrder": ["Creative", "Gaming", "Music"]
  }
}
```
````

Register a unique application in the [Twitch developer console](https://dev.twitch.tv/console/apps), choose the Public client type, and copy its Client ID into the widget configuration. If registration requires a redirect URI, use `https://localhost`; the device-code connection flow does not use a callback. No client secret is required. Connect in the widget, authorise the displayed code on Twitch, then return to Life Manager. The only requested permission is `user:read:follows`. [Twitch's device-code documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow) describes this flow.

Channel links open Twitch on the viewing device. Create Item always adds a fresh child named after the channel, with a channel link in its notes. Existing Items never suppress live channels. Group names derive from the channel-login mapping; unmapped channels appear in Ungrouped. Reorder groups or change membership in the Markdown configuration.

Add activity widgets through the Notes editor and configure their Markdown blocks for your own media directories and Twitch application.

## Codex dispatch

Saved prompts interpolate `{{item.name}}`, `{{item.url}}` and `{{item.id}}` for the selected Item. The server appends its loopback read API URL and the local Life Manager skill location, so agents on the server host can read Items directly. Sending does not change lifecycle or effort.

The selected prompt appears as an inline link at the right of the Notes heading. Click its text to open Codex; click its chevron or surrounding control to choose another prompt. Links are prepared automatically when the Item or prompt changes. This is an ordinary browser link on every device, so the viewing device decides which app handles it. Preparation does not launch an application, submit a task, or enqueue work. Notes retain their usual autosave behavior. Manage templates under the global Settings cog → Prompts.

The link uses `codex://threads/new` with encoded `prompt` and `path` parameters. The [official deep-link reference](https://learn.chatgpt.com/docs/reference/commands#deep-links) describes a prefilled composer requiring Send and documents no new-task host selector. iPhone handling is an experiment; the link does not nominate a remote execution host. Host-local paths and the loopback API context are useful when the task runs on the application server.

## Verification

```sh
npm run verify
```

This runs strict TypeScript checks, domain/storage/HTTP/UI tests and the production build. HTTP tests bind temporary localhost ports. Browser checks have covered desktop, 820px and 390px layouts, URL/back navigation, source saving, Create mode, last-sibling allocation dragging and effort beyond the visual cap. A physical iPhone/Safari trial remains outstanding.
