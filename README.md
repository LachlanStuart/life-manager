# Life Manager

**Notion-like notes and task boards meet a Goalscape-inspired map of your attention.**

Life Manager brings projects, routines, learning and leisure into one personal workspace. Keep the context you would put on a Notion page, give each pursuit a place in a visual hierarchy, and choose how much of your attention it deserves right now.

Use the sunburst to plan. Switch to Kanban when you're ready to act. Return to your notes when you need to pick up where you left off.

![Animated tour of planning, project notes, board filtering and changing a task's status](docs/media/workflow.gif)

## What you can do

- **See the whole picture.** Arrange areas, projects and tasks in a zoomable sunburst. Resize slices to express their relative importance.
- **Keep today's choices manageable.** Hide inactive branches without losing their notes or next steps. Bring them back when your interests change.
- **Work from a familiar board.** Group cards by a single-choice property, drag them between its options, and sort temporarily by importance, effort or property order. Card size reflects intended attention.
- **Make the workspace yours.** Name your workspace, organise its top-level Items, and define properties with your own labels, colours and creation defaults.
- **Keep tasks and knowledge together.** Every Item has children and rich Markdown notes, with checklists, images, links, tables and direct source editing.
- **Reflect without a timer.** Record effort against your intention, including effort above 100%. For checklist-style projects, let completed children contribute automatically.
- **Preserve each planning period.** Capture Opening, Planned and Closing snapshots, including titles, hierarchy, notes, visibility, allocations and property configuration. Revisit a period as it was at the time.
- **Bring activities into your notes.** Optional widgets list local media or live Twitch follows; turn an interesting entry into an Item when you want to keep it.
- **Keep your workspace on your own machine.** Use desktop and phone browsers against one server. Your notes and history live in a local SQLite database, with JSON export available.

## Plan around the life you actually lead

A fresh workspace starts with four areas:

| Area | What belongs here |
| --- | --- |
| **Tend** | Routines, obligations and practical projects |
| **Build** | Things you want to make, experiment with or improve |
| **Learn** | Deliberate study and practice |
| **Enjoy** | Leisure, entertainment and downtime |

These are starting points: use Settings → Top-level Items to rename, add, reorder or remove them. The same Item can hold a short task, a long-running project or a page of ideas with children underneath it.

A slice's size means **intended share of attention**. Its fill means **effort spent relative to that intention in the current period**. Neither is a time estimate or an overall project-completion percentage. You can finish a productive session on an open-ended project without pretending the whole project is nearly done.

Click or tap a branch to zoom, or a leaf to open its details. The center opens the focused Item; the ↑ control goes to its parent. Double-click on desktop or long-press on touch to open any Item directly. **+ New** creates an Item in the current branch in either view. Desktop Omni mode also puts allocation, effort and creation controls directly on the wheel.

### Switch to execution

The Kanban board keeps the same hierarchy and focus. Related tasks stay grouped by their parent, while the small wheel and branch navigation help you choose what to work on.

![Kanban board with related tasks grouped inside status columns](docs/media/kanban-board.png)

The starting Status options use **Now** for work you intend to tackle, **Doing** while it's underway, and **Blocked** when something is in the way. **Done** records completion, **Later** keeps a possibility for reconsideration, **Skip** means it isn't relevant this period, and **Cut** means you've intentionally abandoned it.

Choose **Group by** to organise columns by another property, and **Color by** to colour cards and the wheel independently. Each property includes an unset choice.

Parents with included children stay off the board so the actionable children take the space. A parent with no included children can remain visible as a placeholder for work you still need to define.

### Leave yourself a good place to resume

Open an Item to edit its children and notes together. Record a blocker, paste a useful link, or leave a few lines about the next experiment. Notes autosave, and Markdown source mode is available when you want direct control.

![Project details beside the attention map, with editable children and next-session notes](docs/media/project-notes.png)

When it's time to reconsider your priorities, use the period menu to capture your plan or begin the next period. Rollover preserves the previous period and carries your current work forward; it does not automatically reset tasks.

## Browser demo

[Try the interactive demo](https://lachlanstuart.com/life-manager/). The browser-only build lets you try the planner, boards, notes and snapshots with fictional sample projects. It stores changes in this browser only. **There is no data export, and browser storage can be cleared without warning: do not use the demo for anything you need to keep.** Local media, Twitch and agent launch need the self-hosted app below.

## Install and try it

You'll need **Node.js 22.12 or newer**, npm and Git. Use the same Node version for installation and execution.

```sh
git clone https://github.com/LachlanStuart/life-manager.git
cd life-manager
npm ci
npm run build
npm run demo
```

Open **[localhost:4317](http://localhost:4317)**. The demo contains only fictional sample projects and stores your trial edits separately in `.demo-data/`.

To start your own workspace, stop the demo with **Ctrl+C**, then run:

```sh
npm start
```

This starts a separate workspace in `.data/`, with the four initial areas and no sample projects. Stop the server with Ctrl+C when you're finished.

## Configure your workspace

Under **Settings → Workspace and properties**, edit the workspace name and add single-choice properties. Give each property ordered options, colours, an unset label, and a default for new Items. Defaults never fill existing Items retroactively. Edit an Item’s values under **Properties**, or use the inline and child bulk pickers.

The optional **Lifecycle property** determines calculated effort: Completed gives leaves 100%; No calculated effort gives an Item 0% even when it has children. Manual effort overrides either behaviour. Status has this role initially; colouring and grouping by another property do not change it.

Settings also contains top-level Items, saved agent prompts and sunburst display preferences. Workspace configuration, Items and history are saved on the server. Display preferences such as label sizes and padding are saved in that browser.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Choose the server port |
| `HOST` | `0.0.0.0` | Network interface; use `127.0.0.1` for access from this computer only |
| `LIFE_MANAGER_DATA_DIR` | `.data/` | Choose where your personal workspace is stored; the demo always uses `.demo-data/` |

For example, to keep access local to this computer on macOS or Linux:

```sh
HOST=127.0.0.1 npm start
```

### Use it on your phone

Connect to the server's address through a trusted private network, such as Tailscale. The phone uses the same workspace, and the host must be awake with the server running. This is an ordinary online web app; offline editing is not supported.

**There is no sign-in screen or multi-user isolation. Keep the server on a trusted private network and do not expose it directly to the public internet.**

### Optional activity widgets and agent prompts

Add widgets from the Notes editor and edit their configuration in Markdown:

- **Local videos:** choose an absolute media-directory path and optional folder exclusions. The widget lists immediate files and folders on the server; it does not play or host videos.
- **Twitch:** supply your own public Twitch Client ID, connect your account, and group followed channels however you like. No client secret is needed.
- **Agent prompts:** save reusable prompts that include an Item's title, link and ID. The Notes link opens a prefilled task in Codex on the viewing device; it does not automatically submit the task or choose a remote host.

See the [configuration reference](docs/REFERENCE.md#widgets) for widget examples and Twitch setup, or [agent prompts](docs/REFERENCE.md#codex-dispatch) for the integration details. None of these integrations is required for ordinary planning and note-taking.

### Back up your data

Back up the **whole data directory**, including the SQLite database and `attachments/`. Stop the server before making a simple folder copy. For backups while the app is running, use SQLite's backup facilities and preserve the attachments alongside the database.

[Download a JSON export](http://localhost:4317/api/export) from a server on the default local port, or use `/api/export` on your server's address. JSON exports include current and historical records, but do not replace an attachments backup.

Keep data directories and authorisation tokens private. [Storage details](docs/REFERENCE.md#storage) describe what is saved.

## Development and feedback

Life Manager is early, self-hosted software for a single personal workspace. It has no built-in reminders, automatic recurrence or time tracking. Routine review and period rollover are deliberate actions.

For a source update, stop the server, pull the changes, then run `npm ci`, `npm run build` and `npm start` again. Back up your workspace before updating.

To check changes locally:

```sh
npm run verify
```

This runs the TypeScript checks, tests and production build. `npm run dev` watches server changes; rebuild after editing the frontend.

[Report a bug or suggest an improvement](https://github.com/LachlanStuart/life-manager/issues). For integrations and contributors, the [technical reference](docs/REFERENCE.md), [product model](PRD.md) and [agent API guide](skills/life-manager/SKILL.md) describe the existing behaviour.

Inspired by Notion's combination of notes and task organisation and Goalscape's visual approach to priorities. Life Manager is an independent project.

## License

[MIT](LICENSE).
