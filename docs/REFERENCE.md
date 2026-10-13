# Configuration and technical reference

For installation and the everyday workflow, see the [README](../README.md).

## Storage

The server uses Node HTTP, SQLite (`better-sqlite3`) and a Vite/React client. MDXEditor is loaded when an Item is opened. Domain calculations are shared with the server; HTTP actions validate inputs and use revision checks to avoid silently applying stale writes.

Settings → Appearance stores `system` (default), `light` or `dark` in client local storage under `life-manager.theme`, outside workspace snapshots and exports. System follows `prefers-color-scheme`, including live changes. If storage is unavailable, the selected appearance lasts for the session.

The database is `life-manager.sqlite` inside the configured data directory. On macOS the server and desktop app both default to `~/Library/Application Support/Life Manager/workspace/`, outside the source checkout. Other server platforms default to `.data/` in the project root. `LIFE_MANAGER_DATA_DIR` overrides the standalone server location; the desktop directory is selected in Connection Settings. Managed images live in `attachments/` and use Markdown URLs such as `/attachments/<id>.png`. Images referenced by older snapshots are retained. Back up the database and attachments together; stop the server before making a simple filesystem copy, or use SQLite's backup facilities while it runs.

Existing checkout-local workspaces are not moved automatically. On macOS, startup detects `.data/life-manager.sqlite` and requires either an explicit override or moving the entire workspace to the new location. A legacy `.data` symlink to the new default is supported. Time Machine inclusion depends on machine-specific exclusions; check the actual directory with `tmutil isexcluded` after relocation.

[src/store.ts](../src/store.ts) owns the schema and additive migrations. [src/types.ts](../src/types.ts) defines the corresponding application records:

- `items`: `id`, `parent_id`, `sibling_order`, `title`, `status`, `properties_json`, Markdown `notes`, `included`, `weight`, `allocation_auto` (default false for existing Items), nullable `effort_override`, nullable `default_prompt_id`, nullable `resource_uri`.
- `deleted_items`: one row per deleted branch, with an entry `id`, root `title`, original `parent_id`, `deleted_at`, `item_count`, and complete branch records in `items_json`. Current deletion archives the branch and removes its active rows in one transaction.
- `prompt_templates`: `id`, `name`, `prompt`. An Item's unset default inherits from its nearest configured ancestor.
- `periods`, `snapshots`, `life_manager_meta`: period boundaries, complete Item snapshots, workspace settings and the current revision. A snapshot stores its Item records in `items_json`, including notes and hidden Items, and its workspace configuration in `settings_json`. Current configuration is the `workspace_settings` metadata value.

`resource_uri` is a specific saved file/folder reference for the video widget, separate from single-choice properties. Prompt defaults and resource references are included in snapshots. Templates are current application configuration; deleting a template clears current defaults without rewriting historical Item records.

Call `initializeDatabase(db)` before `createLifeManagerStore(db)`. New stores seed the Topic IDs `tend`, `build`, `learn`, `enjoy` as an editable starting template. Roots are ordinary Items with `parentId: null`; there are no required root names or fixed root count. There is no built-in importer. Use the shared API or prepare an offline migration into a new data directory when bringing in existing material.

## Shared API

All paths are relative to the running server. POST requests use `Content-Type: application/json` and `X-Life-Manager: 1`. Cross-origin browser actions are rejected. Read endpoints are ordinary GETs.

| Endpoint | Input / result |
| --- | --- |
| `GET /api/server` | Application identifier, desktop protocol version and running instance ID. Used for automatic local workspace-owner attachment. |
| `GET /api/workspace` | Current Items, workspace settings, periods, snapshot summaries, widgets, prompt templates and `recycleBin` summaries. Add `?snapshotId=<id>` for a checkpoint. |
| `GET /api/items/<id>` | Item, immediate children, ancestors, revision and period context. Supports `snapshotId`. |
| `POST /api/mutate` | `{command, expectedRevision?, snapshotId?}`; returns the updated workspace. |
| `POST /api/recycle-bin/restore` | `{id, expectedRevision?}`; restores the specified recycle-bin entry into the current workspace and returns it. |
| `POST /api/settings` | `{settings, expectedRevision?, replacements?}`; saves current workspace configuration and returns the workspace. |
| `POST /api/plan` | `{expectedRevision?}` |
| `POST /api/rollover` | `{name?, expectedRevision?}` |
| `GET /api/export` | Complete current/historical Items, recycled branches, workspace settings, and templates as JSON. |
| `GET /api/templates` | Saved templates. |
| `POST /api/templates/save` | `{id, name, prompt}` |
| `POST /api/templates/delete` | `{id}` |
| `POST /api/widgets/render` | `{widgetId, itemId, config?, snapshotId?}` → `{html}` |
| `POST /api/widgets/action` | Render context plus `{action, input?}` |
| `POST /api/agent/link` | `{itemId, templateId, target?, context?}` → `{message, prompt, url?}`. Target is `modal` (default), `codex` or `t3`; only `codex` adds a link. `context: "client"` uses the request origin and public skill reference. Preparation has no launch side effects. |
| `POST /api/agent/t3` | `{prompt, webhookUrl}` → `{accepted: true}` after the webhook accepts the request. Sends from the Life Manager server; requires the normal same-origin action protections. |
| `POST /api/attachments` | Raw PNG/JPEG/GIF/WebP bytes, image content type and `X-Life-Manager: 1`; returns `{url}`. Maximum 20 MB. |

Commands support create, update, delete, delete-many, move, arrange, restore-arrangement, reorder, allocate and bulk updates. New Items default to automatic allocation unless an explicit `patch.weight` or optional creation `share` is supplied. Creation `share` applies a local percentage atomically with the new Item. `allocate` with `share: null` enables automatic allocation; blanks equally divide the remainder after included explicit shares. With included blanks, manual weights represent percentages; without them, weights retain proportional normalization. The additive optional `allocationAuto` field is retained in checkpoint and export Items (schema version 2); absent means manual, preserving older exports and snapshots. `delete` and `delete-many` archive current subtrees in the recycle bin atomically while preserving historical snapshots. Overlapping selections create one entry per highest selected root. See [the agent skill](../skills/life-manager/SKILL.md) for examples. Revision conflicts return HTTP 409. Other invalid operations return an error string. Browser clients receive change notifications over `/api/events` and refresh current server state.

`allocate` optionally accepts `siblingIds` for a filtered view. The list must contain at least two distinct included siblings, including the target. `share` must be numeric and describes the target’s percentage of that subset’s existing combined allocation. Other listed siblings divide the remainder proportionally (equally when their prior shares are all zero). Unlisted siblings retain their effective shares; descendants and inclusion are unchanged. Edited siblings become explicit, while unlisted automatic siblings retain automatic mode. Explicit weights may be normalized to percentages to preserve effective shares alongside automatic siblings. A zero-budget subset is rejected. For example, A/B/C at 30/30/40 with `siblingIds: ["A", "B"]` and `share: 75` produces 45/15/40. The command is atomic and uses the usual revision and snapshot rules.

Current workspace `recycleBin` entries are `{id,title,parentId,deletedAt,itemCount}`, ordered newest first; `itemCount` includes the root. Restoration preserves Item IDs, notes and descendant structure, appends the root to its surviving original parent (otherwise the workspace root), and applies ordinary allocation normalization. Property values no longer defined by current settings become unset; removed property fields and missing prompt references are cleared. A conflicting active Item ID or stale revision rejects restoration without changing the bin. Restore has no `snapshotId` input. Historical correction deletions remain local to their snapshot and do not enter the bin. Recycle entries have no automatic expiry or permanent-deletion endpoint. Schema-version-2 exports include an additive `recycleBin` array with each summary plus its full `items`.

Restart the server after deploying backend changes. Rebuilding the web client alone does not reload the running server. If a current workspace response lacks `recycleBin`, the client blocks Item deletion and shows a server-restart message rather than treating the bin as empty.

## Workspace settings and properties

`settings` is `{name, properties, lifecyclePropertyId}`. Each property is `{id, name, options, unsetLabel, unsetColor, defaultValue, unsetShowByDefault?, inheritFromParent?, fallbackValue?}`; each option is `{id, label, color, behavior?, showByDefault?}`. The optional visibility booleans default to true and are preserved in snapshots and exports. They affect initial presentation, not inclusion or effort. Inherited values follow their resolved option’s visibility; there is no separate Inherit visibility setting. For legacy properties, blank Status follows the creation default’s visibility, and `unsetShowByDefault` applies to Status only when its creation default is null. Arrays define property and option order. Colours are six-digit hex values. IDs are stable when labels change. `defaultValue` is an option ID or `null`; `lifecyclePropertyId` is a property ID or `null`.

`arrange` accepts `{ids, parentId, beforeId?}` and moves selected branch roots in the supplied order in one transaction. A selected descendant travels with its selected ancestor. `beforeId` must identify an unmoved destination sibling; omitting it appends. Self/descendant destinations and invalid IDs are rejected before writes. Destination order includes excluded siblings, and the standard allocation normalization runs once after the move.

`restore-arrangement` accepts `placements` (every Item's `{id, parentId, order, weight, allocationAuto?}` before a move) and `expected` (the post-move placements plus each Item's `included` flag). It rejects changed membership, placement, inclusion or allocation, then restores only placement/allocation fields atomically without renormalizing the saved weights. Notes, properties, effort and other Item fields remain current. Clients also send the normal `expectedRevision` for concurrency protection. Historical corrections use the same commands with `snapshotId` and remain isolated from current and other historical data.

The Outline view uses `?view=outline`, including in browser-demo hash routes. Its expansion, All Items / Dashboard only filter, title search and selection are local to the loaded period and survive view switching. Sort overrides preserve hierarchy; reordering is available only under Order with no search or property filters. All Items in Outline retains real allocation values and does not enable the wheel's Show all geometry.

Shared property filters use the `filters` URL parameter (also inside browser-demo hash routes): a JSON object mapping property IDs to disabled option IDs, with `null` representing legacy Unset. Inheriting properties filter only concrete resolved option IDs. Omitted properties use their configured default visibility; an explicit empty array shows all values for that property. Kanban ignores default hiding on its grouping property, but honours explicit overrides, including an empty array. Values are combined with OR within a property and AND across properties. The client ignores malformed entries and IDs absent from the displayed configuration. These are presentation settings; no mutation or database migration is involved.

The client saves filters under `life-manager.property-filters` in local storage. Startup restores them when the URL omits `filters`; an explicit URL value (including `{}` to use configured defaults) takes precedence. Browser Back follows the URL without falling back to storage. Reset to defaults saves an empty override object. Show everything saves an empty array for every configured property. If storage is unavailable, filters still work for the session and in URLs.

The reserved property ID `status` stores its value in `Item.status`; other fields use `Item.properties[propertyId]`. Values are option IDs or `null`; missing custom fields are equivalent to null. Updates and bulk patches merge supplied `properties` entries, preserving other fields. For example, `{properties: {priority: "high"}}` changes only Priority; `{properties: {priority: null}}` clears it. Creation applies configured defaults only for omitted fields. Adding a property or changing its default never fills existing stored values. `inheritFromParent: true` makes null resolve through the nearest ancestor with a non-null assignment, then `fallbackValue`, which must name an existing option. Resolution uses the full hierarchy independently of inclusion and display filters. `defaultValue` remains the creation default: null creates an inheriting Item; a concrete value creates an explicit assignment. New properties in Settings enable inheritance and default new Items to Inherit. Existing properties are explicitly converted in Settings. With the flag absent or false, legacy Status resolves null to its creation default and custom properties retain distinct null values. Historical views resolve against their own saved configuration and hierarchy, preserving legacy semantics without migration.

Item patches also accept `allocationAuto`. A bulk patch such as `{allocationAuto: true, effortOverride: null, status: "Later", properties: {priority: null}}` resets selected Items to automatic importance and effort, sets Status to Later, and clears Priority in one transaction. Omitted fields are preserved. The period reset dialog uses this command with all current Item IDs; its selected values are submitted as stored assignments, including null for Inherit. Item details can bulk-set any property on selected direct children or their complete descendant branches; the UI expands that scope to explicit IDs, including hidden Items, before submitting the same atomic bulk command.

`POST /api/settings` replaces the complete configuration atomically. Removed option values become unset unless `replacements[propertyId][removedOptionId]` names a retained option or explicitly supplies `null`. Removing a property removes its current values. Settings edits increment the current revision and leave historical snapshots unchanged.

The designated lifecycle property’s resolved option `behavior` is `normal` (also the omitted default), `complete`, or `skip`. Complete gives leaf Items 100% calculated effort; skip gives an Item 0% calculated effort even if it has children. Manual overrides take precedence. Default Status maps Done to complete and Skip/Cut to skip. Hide finished uses complete/skip independently of manual effort. Color by and Group by are independent presentation choices and do not designate lifecycle behaviour.

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

<a id="codex-dispatch"></a>

## Agent prompts

Saved prompts interpolate `{{item.name}}`, `{{item.url}}` and `{{item.id}}` for the selected Item. For tasks running on the server, it appends the loopback read API URL and local Life Manager skill location. T3 prompts use the viewing client’s Life Manager origin and the public API skill URL, so remote server paths are not treated as local client paths. Sending does not change lifecycle or effort.

The selected prompt appears as an inline action at the right of the Notes heading. Click its text to use the selected prompt handler; click its chevron or surrounding control to choose another prompt. The dialog includes the interpolated template and the appended API/skill context, with a Copy prompt button and manual selection if clipboard access fails. Prompts are prepared automatically when the Item, template or handling choice changes.

Settings → Prompts → Prompt handling defaults to **Show prompt dialog**, with **Codex** and **T3 Code** as alternatives. The choice is stored in this client’s local storage (`life-manager.prompt-handling`), outside workspace snapshots and exports. Saved templates remain shared workspace configuration.

With T3 Code selected, **T3 webhook URL** saves automatically in this client’s local storage (`life-manager.t3-webhook-url`). It is required and contains a secret: it is outside workspace snapshots and exports, but remains in this browser or desktop profile. The old app-location preference is no longer used.

In a webhook-capable T3 Code version, create a task in **Settings → Scheduled tasks**, choose **On webhook**, and use `{{body.prompt}}` as its prompt. Configure its project, model and thread behavior in T3, leave signature validation disabled, and copy the complete webhook URL into Life Manager. Public relay URLs require a configured T3 Connect managed tunnel; a displayed path alone is not a usable URL. HTTP and HTTPS URLs are accepted, including a directly reachable T3 endpoint. Life Manager posts `Content-Type: application/json` with `{ "prompt": "the full prepared prompt" }`. The URL token provides authorization; custom signatures are not sent.

Clicking an Item's prompt action submits it immediately. A popup reports webhook acceptance, which does not guarantee that the task has started or completed; inspect T3's task and delivery history for progress. It also offers **Show prompt** for manual recovery. Preparation has no delivery side effects. Failed or uncertain requests are never retried automatically. Check T3 before resubmitting after a timeout or connection error to avoid duplicate tasks.

Browser clients call the protected `POST /api/agent/t3` endpoint, which sends the webhook from the Life Manager server without browser CORS restrictions. Electron uses a main-frame, origin-checked preload bridge and sends from its own main process, including when connected to a remote Life Manager server. An unavailable or outdated Electron bridge reports an error rather than falling back to the remote server. The webhook must be reachable from the sending computer. Requests time out after 30 seconds and do not follow redirects. Errors omit webhook URLs and upstream response bodies to avoid exposing the URL secret.

T3 prompts reference the viewing client's Life Manager origin and the public API skill URL. Open Life Manager using an address reachable from the T3 host; a loopback address only works when both run on the same computer. The T3 webhook task determines the agent's project and working directory.

## Verification

```sh
npm run verify
```

This runs strict TypeScript checks, domain/storage/HTTP/UI tests and the production build. HTTP tests bind temporary localhost ports.

## Desktop operation

The macOS arm64 app uses Electron with a sandboxed window displaying the server's ordinary HTTP UI. A Node utility process hosts local workspaces. The window has no Node access; its sandboxed preload exposes only the native T3 webhook action, guarded by main-frame and origin checks. A separate bundled connection-settings window exposes only configuration, directory selection and connection operations. External links allow HTTP, HTTPS, mail and Codex schemes.

`src/server-runtime.ts` owns server startup and shutdown for both the CLI and desktop utility process. It accepts explicit data, asset and agent-context paths and reports the actual listening port. `src/server-discovery.ts` verifies application identity and protocol compatibility. The desktop can attach to the current standalone server, including one already serving its chosen local directory. Local port/sharing settings apply only when the desktop starts the server; an attached server retains its own settings.

Each data directory has one owning server. A `proper-lockfile` heartbeat lock in `.server.lock` is acquired before opening SQLite. `.server.json` records the owner's URL and instance ID; attachment verifies these against the live server. Clean shutdown removes both records, closes change feeds and SQLite, and releases ownership. A crashed lock can be reclaimed after 30 seconds. Do not manually remove a live server's lock. This coordination applies to updated Life Manager servers; stop older versions before opening the same directory with the desktop app.

Desktop configuration is stored in `~/Library/Application Support/Life Manager/connection.json`, with new workspaces under `workspace/` and diagnostics in `desktop.log`. The menu's **Open Log** opens that log. Browser display preferences remain specific to each browser or the desktop profile. `LIFE_MANAGER_DESKTOP_HOME` overrides the desktop profile directory for isolated testing; standalone `LIFE_MANAGER_DATA_DIR` still configures the CLI workspace.

Before quitting or changing connections, the desktop waits for pending notes and queued edits to finish. A failed save prevents switching connections; Quit offers to keep the window open or explicitly discard unsaved edits. Closing the window normally hides it and lets autosave continue.

Local hosting defaults to loopback and port 4317, as does the standalone CLI. The CLI's `HOST` environment variable can override the listen address. An occupied port is reported rather than silently switching workspaces; choosing port 0 requests an available port. Enabling desktop network access binds to all IPv4 interfaces, including Wi-Fi. For Tailscale access, keep network access disabled and forward a fixed local port through [Tailscale Serve](../README.md#use-it-on-your-phone). There is no authentication; anyone permitted to connect has full application access. Closing the window hides it, while Quit shuts down an app-owned server. An unexpected utility-process exit is reported and can be recovered through Connection Settings. Switching workspaces stops the previous app-owned server. Connected external servers are never stopped by the desktop.

Host integrations run where the server runs. Local media paths and widget commands refer to that computer. Codex links open on the viewing device; a desktop-hosted workspace supplies its data directory as the Codex working directory and the bundled API skill as context. Explicit server connections validate `/api/workspace` and load the server's own UI, supporting releases that predate desktop hosting. The server must be reachable at an HTTP(S) origin without a subpath. `/api/server` and its instance ID are required only for automatic attachment to an existing local workspace owner. TLS verification remains enabled.

`npm run build:desktop` builds the web UI and bundles the desktop main process, workspace and settings preloads, and server worker with esbuild. It stages only application assets, the API skill and the installed SQLite dependency tree. Electron Packager rebuilds `better-sqlite3` in its copied staging directory, preserving the repository's native Node binary. The output is `release/Life Manager-darwin-arm64/Life Manager.app`. The build requires macOS arm64, Node.js 22.12+, Xcode Command Line Tools and network access for Electron/native build downloads. `LSUIElement` hides the Dock icon at startup; window visibility events show it while any window is open or minimized and hide it when all windows are closed or hidden. The Dock icon (`desktop/life-manager.icns`) and menu-bar template (`desktop/tray-template.png`) use the same mark as `public/favicon.svg`. Rebuild the desktop bundle to update them. The app is intended for local installation; distribution signing, notarization and automatic updates are not configured.

After building, `npm run test:desktop` launches the packaged app against temporary profiles and verifies window loading, the native database, live notifications, persistence across restart, automatic attachment to an existing workspace owner, and explicit server connections. It also verifies that Quit stops only app-owned servers and that a remote connection sends its prompt through the native webhook bridge. The delivery check uses a temporary local HTTP receiver without starting a real T3 task. Use the same Node runtime used to install dependencies, as with `npm run verify`.

### Cocoa/WebKit launcher

`desktop/cocoa/lm` invokes `uv run --locked` against [desktop/cocoa/pyproject.toml](../desktop/cocoa/pyproject.toml) and its committed lockfile. Python 3.13 and PyObjC provide `NSApplication`, a retained `NSStatusItem` and `WKWebView`. No application bundle or Electron process is created. The ordinary production `dist/` UI and [shared server runtime](../src/server-runtime.ts) are used without a frontend fork or workspace migration.

`lm` and `lm start` start or reopen the desktop, `lm status` reports JSON containing the desktop/server PIDs, origin, data directory and visibility, and `lm stop` requests save-aware Quit and waits until the owned server has exited. Successful stop returns `{"state":"stopped"}`. A failed save leaves stop waiting for the dialog decision; **Keep Open** returns a cancellation error with nonzero exit status. Status and reopening remain available while stop waits. Commands accept these options:

| Option | Environment / default | Purpose |
| --- | --- | --- |
| `--data-dir` | `LIFE_MANAGER_DATA_DIR`, otherwise the standard macOS workspace | Open an existing workspace in place or create a new one. |
| `--node` | `LIFE_MANAGER_NODE`, otherwise `node` on PATH | Select the installed Node runtime that matches the checkout's SQLite binary. |
| `--home` | `LIFE_MANAGER_COCOA_HOME`, otherwise `~/Library/Application Support/Life Manager/cocoa/` | Select the launcher profile, preferences, log and single-instance control files. Use the same profile for start, stop and status. |
| `--port` | `0` | Request an available loopback port, or specify a fixed port. `HOST` is ignored; this launcher always binds `127.0.0.1`. |

A profile holds an OS file lock for its entire desktop lifetime. Its private Unix control socket accepts only open, stop and status commands. Repeated or simultaneous launches reopen the owner; stale sockets are replaced only after acquiring the lock. An independently served workspace is refused, with its address reported in `desktop.log`. Remote connections and server attachment remain Electron features.

[server.ts](../desktop/cocoa/server.ts) runs in an owned Node child and uses a private newline-JSON stdin/stdout transport. Closing the parent pipe stops the server, including during startup or after a Python crash. Normal shutdown closes live feeds and SQLite and releases the workspace lock. The parent bounds unresponsive shutdown with termination and kill fallbacks. The transport also calls the existing [desktop T3 sender](../desktop/agent-launch.ts), preserving webhook validation, timeout, secret-safe errors and the no-retry rule.

The [native shell](../desktop/cocoa/cocoa.py) checks WebKit's actual web view, main-frame flag and security origin before accepting `sendT3`, `setPreference` or the token-matched Quit completion. The document-start script exposes only the shared T3 method and synchronous preference accessors. It never exposes Python objects, shell commands, file paths or generic request/evaluation methods. External navigation is blocked in the workspace view; supported HTTP, HTTPS, mail and Codex links open through macOS. Widget frames cannot invoke the native bridge.

Appearance, prompt handling, T3 webhook URL, property filters and sunburst display preferences are stored in the profile's private `preferences.json`, outside workspace snapshots and exports. Preferences are injected before React starts and persist across changing server ports. Browser and Electron clients retain their existing storage. WebKit uses an ephemeral website data store; arbitrary website storage is not persisted. Preference writes are included in save-aware Quit. A failed write or note save keeps the desktop open unless the user explicitly discards it.

The Dock image and menu-bar template are loaded directly from `desktop/life-manager.icns` and `desktop/tray-template.png`, the same files used by Electron. Closing or pressing Command+Q hides the retained window and Dock presence; the status item and server stay alive. Command+Q invokes **Hide Life Manager**; the explicit **Quit Life Manager** menu action and `lm stop` shut down. Reopening restores regular activation and reapplies a retained image view to the Dock tile, including in an unbundled Python process. Minimizing retains the Dock icon. Source icon updates take effect on the next launch.

`desktop.log` records startup and server errors; **Open Log** is available in the status menu. If Node exits unexpectedly, status reports `server-stopped`; quit and restart after resolving the log's error. If startup reports a `NODE_MODULE_VERSION` mismatch, stop the desktop and use the same Node executable for `npm rebuild better-sqlite3` and `LIFE_MANAGER_NODE`. A missing prebuilt SQLite binary may require Xcode Command Line Tools for compilation. Rebuilding Electron uses its separate staging directory and does not replace the checkout's Node binary.

Run the checks with that same Node on PATH:

```sh
npm run verify
npm run test:cocoa
npm run test:cocoa:desktop
```

The Python runtime checks exercise SQLite persistence, ownership exclusion, parent-crash and early-EOF cleanup, the control socket and bridge validation. The macOS desktop checks require a logged-in graphical session and open disposable windows. They exercise the real React/MDXEditor, concurrent reopening, repeated close/menu/Dock icon transitions, minimize/restore, preferences across restarts, native webhook delivery to a temporary local receiver, rejected subframe calls and external navigation, and successful/failed save-aware Quit. Logs and temporary workspaces are printed under `/tmp/life-manager-cocoa-*`; no real T3 task is invoked.

## Browser-only demo

```sh
npm run build:demo
npm run preview:demo
```

Open the `/life-manager/` URL printed by the preview server. `dist-demo/` contains only static assets and the synthetic sample workspace. No application server, private data directory or credentials are deployed. Hash-based Item routes let deep links reload on static hosting.

The demo uses sql.js (SQLite compiled to WebAssembly) with the same schema, mutations and period/snapshot logic as the native server. It saves the database image to IndexedDB after successful edits. Web Locks serialize operations between tabs; each operation reads the latest saved image and revision checks still apply. A failed IndexedDB write is reported as a save error, not a successful edit.

Browser storage is disposable. The startup dialog and persistent banner warn that data may disappear and there is no supported export from the demo. This is not a backup, sync or offline-app offering. A current browser with IndexedDB, WebAssembly and Web Locks is required.

Branch tools run locally. Local media access, Twitch authentication and agent launch require the self-hosted version. Demo image uploads embed data URLs in notes and accept PNG/JPEG/GIF/WebP files up to 2 MB each. The normal server's upload and export behavior is unchanged.
