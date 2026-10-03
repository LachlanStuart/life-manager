# Configuration and technical reference

For installation and the everyday workflow, see the [README](../README.md).

## Storage

The server uses Node HTTP, SQLite (`better-sqlite3`) and a Vite/React client. MDXEditor is loaded when an Item is opened. Domain calculations are shared with the server; HTTP actions validate inputs and use revision checks to avoid silently applying stale writes.

The database is `life-manager.sqlite` inside the configured data directory. On macOS the server and desktop app both default to `~/Library/Application Support/Life Manager/workspace/`, outside the source checkout. Other server platforms default to `.data/` in the project root. `LIFE_MANAGER_DATA_DIR` overrides the standalone server location; the desktop directory is selected in Connection Settings. Managed images live in `attachments/` and use Markdown URLs such as `/attachments/<id>.png`. Images referenced by older snapshots are retained. Back up the database and attachments together; stop the server before making a simple filesystem copy, or use SQLite's backup facilities while it runs.

Existing checkout-local workspaces are not moved automatically. On macOS, startup detects `.data/life-manager.sqlite` and requires either an explicit override or moving the entire workspace to the new location. A legacy `.data` symlink to the new default is supported. Time Machine inclusion depends on machine-specific exclusions; check the actual directory with `tmutil isexcluded` after relocation.

[src/store.ts](../src/store.ts) owns the schema and additive migrations. [src/types.ts](../src/types.ts) defines the corresponding application records:

- `items`: `id`, `parent_id`, `sibling_order`, `title`, `status`, `properties_json`, Markdown `notes`, `included`, `weight`, `allocation_auto` (default false for existing Items), nullable `effort_override`, nullable `default_prompt_id`, nullable `resource_uri`.
- `prompt_templates`: `id`, `name`, `prompt`. An Item's unset default inherits from its nearest configured ancestor.
- `periods`, `snapshots`, `life_manager_meta`: period boundaries, complete Item snapshots, workspace settings and the current revision. A snapshot stores its Item records in `items_json`, including notes and hidden Items, and its workspace configuration in `settings_json`. Current configuration is the `workspace_settings` metadata value.

`resource_uri` is a specific saved file/folder reference for the video widget, separate from single-choice properties. Prompt defaults and resource references are included in snapshots. Templates are current application configuration; deleting a template clears current defaults without rewriting historical Item records.

Call `initializeDatabase(db)` before `createLifeManagerStore(db)`. New stores seed the Topic IDs `tend`, `build`, `learn`, `enjoy` as an editable starting template. Roots are ordinary Items with `parentId: null`; there are no required root names or fixed root count. There is no built-in importer. Use the shared API or prepare an offline migration into a new data directory when bringing in existing material.

## Shared API

All paths are relative to the running server. POST requests use `Content-Type: application/json` and `X-Life-Manager: 1`. Cross-origin browser actions are rejected. Read endpoints are ordinary GETs.

| Endpoint | Input / result |
| --- | --- |
| `GET /api/server` | Application identifier, desktop protocol version and running instance ID. Used for automatic local workspace-owner attachment. |
| `GET /api/workspace` | Current Items, workspace settings, periods, snapshot summaries, widgets and prompt templates. Add `?snapshotId=<id>` for a checkpoint. |
| `GET /api/items/<id>` | Item, immediate children, ancestors, revision and period context. Supports `snapshotId`. |
| `POST /api/mutate` | `{command, expectedRevision?, snapshotId?}`; returns the updated workspace. |
| `POST /api/settings` | `{settings, expectedRevision?, replacements?}`; saves current workspace configuration and returns the workspace. |
| `POST /api/plan` | `{expectedRevision?}` |
| `POST /api/rollover` | `{name?, expectedRevision?}` |
| `GET /api/export` | Complete current/historical Items, workspace settings, and templates as JSON. |
| `GET /api/templates` | Saved templates. |
| `POST /api/templates/save` | `{id, name, prompt}` |
| `POST /api/templates/delete` | `{id}` |
| `POST /api/widgets/render` | `{widgetId, itemId, config?, snapshotId?}` → `{html}` |
| `POST /api/widgets/action` | Render context plus `{action, input?}` |
| `POST /api/agent/link` | `{itemId, templateId}` → `{message, url}` containing a prefilled `codex://` link. |
| `POST /api/attachments` | Raw PNG/JPEG/GIF/WebP bytes, image content type and `X-Life-Manager: 1`; returns `{url}`. Maximum 20 MB. |

Commands support create, update, delete, delete-many, move, reorder, allocate and bulk updates. New Items default to automatic allocation unless an explicit `patch.weight` or optional creation `share` is supplied. Creation `share` applies a local percentage atomically with the new Item. `allocate` with `share: null` enables automatic allocation; blanks equally divide the remainder after included explicit shares. With included blanks, manual weights represent percentages; without them, weights retain proportional normalization. The additive optional `allocationAuto` field is retained in checkpoint and export Items (schema version 2); absent means manual, preserving older exports and snapshots. `delete-many` accepts `ids` and removes all selected subtrees atomically while preserving historical snapshots. See [the agent skill](../skills/life-manager/SKILL.md) for examples. Revision conflicts return HTTP 409. Other invalid operations return an error string. Browser clients receive change notifications over `/api/events` and refresh current server state.

## Workspace settings and properties

`settings` is `{name, properties, lifecyclePropertyId}`. Each property is `{id, name, options, unsetLabel, unsetColor, defaultValue}`; each option is `{id, label, color, behavior?}`. Arrays define property and option order. Colours are six-digit hex values. IDs are stable when labels change. `defaultValue` is an option ID or `null`; `lifecyclePropertyId` is a property ID or `null`.

The reserved property ID `status` stores its value in `Item.status`; other fields use `Item.properties[propertyId]`. Values are option IDs or `null`, and a missing custom field is unset. Updates and bulk patches merge supplied `properties` entries, preserving other fields. For example, `{properties: {priority: "high"}}` changes only Priority; `{properties: {priority: null}}` clears it. Creation applies configured defaults only for omitted fields. Adding a property or changing its default never fills existing Items.

Item patches also accept `allocationAuto`. A bulk patch such as `{allocationAuto: true, effortOverride: null, status: "Later", properties: {priority: null}}` resets selected Items to automatic importance and effort, sets Status to Later, and clears Priority in one transaction. Omitted fields are preserved. The period reset dialog uses this command with all current Item IDs; its property defaults are resolved to concrete values before submission.

`POST /api/settings` replaces the complete configuration atomically. Removed option values become unset unless `replacements[propertyId][removedOptionId]` names a retained option or explicitly supplies `null`. Removing a property removes its current values. Settings edits increment the current revision and leave historical snapshots unchanged.

The designated lifecycle property's option `behavior` is `normal` (also the omitted default), `complete`, or `skip`. Complete gives leaf Items 100% calculated effort; skip gives an Item 0% calculated effort even if it has children. Manual overrides take precedence. Default Status maps Done to complete and Skip/Cut to skip. Hide finished uses complete/skip independently of manual effort. Color by and Group by are independent presentation choices and do not designate lifecycle behaviour.

Snapshots preserve their workspace name, property definitions and lifecycle role alongside Item values. Historical reads and mutations use that saved configuration. Existing databases gain the default Status definition and snapshot metadata through additive migration. Exports retain schema version 2 with the additional settings and property fields.

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

[src/widgets.ts](../src/widgets.ts) contains trusted widget definitions. A definition returns HTML and registers named, validated server actions. The HTML runs in a sandboxed iframe and can call `window.lifeManager.action(name, input)`. Widgets can call `window.lifeManager.refresh()` to request newly rendered HTML; reloading the iframe alone would replay its old document. Its server action receives the owning Item, config, workspace, shared `mutate` operations and a `runCommand(executable, args)` helper. Command definitions are code; the HTTP API does not expose a general shell endpoint. Restart after editing definitions.

The included Branch tools widget demonstrates Item creation using configured defaults and a bulk reset to the designated lifecycle property’s creation default, while clearing manual effort. Activity definitions live in `src/plugins/`. Historical widgets cannot execute host commands, and their UI action bridge is disabled while viewing a snapshot.

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

Refresh rereads that one directory. Create Item adds a child of the widget owner, with the file stem or folder name, configured property defaults, inclusion enabled and a saved file URL. A current reference anywhere in the hierarchy suppresses the entry unless every referencing Item has complete lifecycle behaviour or the built-in Cut value while Status is the lifecycle property. Skip alone does not release a reference. Hidden Items still count. Folders produce one Item and are never recursively imported. Playback and file moves remain external.

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

This runs strict TypeScript checks, domain/storage/HTTP/UI tests and the production build. HTTP tests bind temporary localhost ports.

## Desktop operation

The macOS arm64 app uses Electron with a sandboxed window displaying the server's ordinary HTTP UI. A Node utility process hosts local workspaces. The window has no Node access or privileged preload; a separate bundled connection-settings window exposes only configuration, directory selection and connection operations. External links allow HTTP, HTTPS, mail and Codex schemes.

`src/server-runtime.ts` owns server startup and shutdown for both the CLI and desktop utility process. It accepts explicit data, asset and agent-context paths and reports the actual listening port. `src/server-discovery.ts` verifies application identity and protocol compatibility. The desktop can attach to the current standalone server, including one already serving its chosen local directory. Local port/sharing settings apply only when the desktop starts the server; an attached server retains its own settings.

Each data directory has one owning server. A `proper-lockfile` heartbeat lock in `.server.lock` is acquired before opening SQLite. `.server.json` records the owner's URL and instance ID; attachment verifies these against the live server. Clean shutdown removes both records, closes change feeds and SQLite, and releases ownership. A crashed lock can be reclaimed after 30 seconds. Do not manually remove a live server's lock. This coordination applies to updated Life Manager servers; stop older versions before opening the same directory with the desktop app.

Desktop configuration is stored in `~/Library/Application Support/Life Manager/connection.json`, with new workspaces under `workspace/` and diagnostics in `desktop.log`. The menu's **Open Log** opens that log. Browser display preferences remain specific to each browser or the desktop profile. `LIFE_MANAGER_DESKTOP_HOME` overrides the desktop profile directory for isolated testing; standalone `LIFE_MANAGER_DATA_DIR` still configures the CLI workspace.

Before quitting or changing connections, the desktop waits for pending notes and queued edits to finish. A failed save prevents switching connections; Quit offers to keep the window open or explicitly discard unsaved edits. Closing the window normally hides it and lets autosave continue.

Local hosting defaults to loopback and port 4317. An occupied port is reported rather than silently switching workspaces; choosing port 0 requests an available port. Enabling network access binds to all IPv4 interfaces. There is no authentication; use a trusted private network only. Closing the window hides it, while Quit shuts down an app-owned server. An unexpected utility-process exit is reported and can be recovered through Connection Settings. Switching workspaces stops the previous app-owned server. Connected external servers are never stopped by the desktop.

Host integrations run where the server runs. Local media paths and widget commands refer to that computer. Codex links open on the viewing device; a desktop-hosted workspace supplies its data directory as the Codex working directory and the bundled API skill as context. Explicit server connections validate `/api/workspace` and load the server's own UI, supporting releases that predate desktop hosting. The server must be reachable at an HTTP(S) origin without a subpath. `/api/server` and its instance ID are required only for automatic attachment to an existing local workspace owner. TLS verification remains enabled.

`npm run build:desktop` builds the web UI and bundles the desktop main process, settings preload and server worker with esbuild. It stages only application assets, the API skill and the installed SQLite dependency tree. Electron Packager rebuilds `better-sqlite3` in its copied staging directory, preserving the repository's native Node binary. The output is `release/Life Manager-darwin-arm64/Life Manager.app`. The build requires macOS arm64, Node.js 22.12+, Xcode Command Line Tools and network access for Electron/native build downloads. `LSUIElement` hides the Dock icon at startup; window visibility events show it while any window is open or minimized and hide it when all windows are closed or hidden. The app is intended for local installation; distribution signing, notarization and automatic updates are not configured.

After building, `npm run test:desktop` launches the packaged app against temporary profiles and verifies window loading, the native database, live notifications, persistence across restart, automatic attachment to an existing workspace owner, and explicit server connections. It also verifies that Quit stops only app-owned servers. Use the same Node runtime used to install dependencies, as with `npm run verify`.

## Browser-only demo

```sh
npm run build:demo
npm run preview:demo
```

Open the `/life-manager/` URL printed by the preview server. `dist-demo/` contains only static assets and the synthetic sample workspace. No application server, private data directory or credentials are deployed. Hash-based Item routes let deep links reload on static hosting.

The demo uses sql.js (SQLite compiled to WebAssembly) with the same schema, mutations and period/snapshot logic as the native server. It saves the database image to IndexedDB after successful edits. Web Locks serialize operations between tabs; each operation reads the latest saved image and revision checks still apply. A failed IndexedDB write is reported as a save error, not a successful edit.

Browser storage is disposable. The startup dialog and persistent banner warn that data may disappear and there is no supported export from the demo. This is not a backup, sync or offline-app offering. A current browser with IndexedDB, WebAssembly and Web Locks is required.

Branch tools run locally. Local media access, Twitch authentication and agent launch require the self-hosted version. Demo image uploads embed data URLs in notes and accept PNG/JPEG/GIF/WebP files up to 2 MB each. The normal server's upload and export behavior is unchanged.
