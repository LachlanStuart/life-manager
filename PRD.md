# Life Manager

## Purpose

A standalone web application for organising personal pursuits, choosing their intended shares of attention, and preserving enough context to resume and reflect on them. Its foundation is a persistent hierarchy of Items, a current dashboard expressing intention, and historical period snapshots.

This is the canonical product specification for the standalone application. The [glossary](CONTEXT.md) defines its language.

## Problem and personal context

Personal pursuits are spread across task boards, notes, code, bookmarks, browser tabs, installed games, and memory. Returning to a dormant project requires reconstructing its context. Choosing a learning or leisure activity often requires enough setup to discourage starting. Routine obligations need to remain visible alongside more attractive possibilities.

The starting template offers four topics for these pursuits:

| Topic | Purpose and characteristic needs |
| --- | --- |
| Tend | Routines and obligations. Includes simple actions and extended undertakings such as recovering an account, assembling tax documents, and making sporadic calls. Routine lists are reviewed manually; some tasks are completed and others are irrelevant for that review. |
| Build | Exploratory making and R&D, driven by novelty and finding better possibilities. Projects often go dormant and need durable notes about progress, blockers, and next steps for easy resumption. |
| Learn | Deliberate learning requiring effort and memory maintenance, predominantly languages, with active cultural enrichment and other skills. Organisation by language and media type and low-friction access to activities matter. |
| Enjoy | Mental downtime, including videos, streams, games, and newsletters. Available options and notes about why they are appealing help with choosing an activity. |

These topics reflect the satisfaction sought from an activity. A shared Item model supports all four; specialised activity  interfaces belong in widgets.

Material brought in from other note-taking or task tools should become canonical in Life Manager unless continued external querying is useful. Import preparation is separate from the application platform.

## User stories

1. As the owner, I want obligations visible when I visit the dashboard, so that they remain in mind while I choose among other pursuits.
2. As the owner, I want tasks, projects, and supporting notes in one hierarchy, so that I can organise each pursuit at the detail it needs.
3. As the owner, I want to add Items quickly at a chosen location, so that capture does not interrupt planning or doing.
4. As the owner, I want to hide a dormant project and later restore its selected next steps, so that reprioritising does not require rebuilding context.
5. As the owner, I want to resize intended attention within a branch, so that I can rebalance local priorities without disturbing its internal plans or other branches.
6. As the owner, I want checklist-derived and manually assessed effort, so that routine work and open-ended pursuits can share a dashboard.
7. As the owner, I want overinvestment visible, so that hyperfocus is apparent even when an activity has no meaningful completion target.
8. As the owner, I want rich project notes and nearby child controls, so that I can record a session and resume it later.
9. As the owner, I want widgets to offer relevant possibilities and launch external activities, so that starting can be quick without turning every option into a task.
10. As the owner, I want explicit period rollover and planning checkpoints, so that past intentions and outcomes remain available for reflection.
11. As the owner, I want to correct historical mistakes locally, so that a correction does not unexpectedly rewrite other periods.
12. As the owner, I want local agents and external processes to access application operations and historical data, so that automation and reporting can evolve outside the platform.

## Item hierarchy and lifecycle

Items form a single-parent hierarchy with configurable top-level Items. A new workspace starts with Tend, Build, Learn, and Enjoy; these are ordinary Items that can be renamed, reordered, added, moved or removed. Notes may link to Items elsewhere without adding parents or additional allocation paths. Language and media type can be branches such as `Learn → Japanese → Games`.

The shared structured information is title, parent and sibling order, single-choice properties, dashboard inclusion, allocation, effort assessment, and rich notes. The workspace has an editable name used in its navigation. Settings provide workspace and property configuration alongside management of top-level Items.

Properties have stable identities, editable names, ordered options with labels and colours, an unset label and colour, and an optional default for new Items. Existing Items remain unset when a property is added or its default changes. Removing an option allows its current values to be reassigned to another option or unset; removing a property removes its current values. Historical snapshots retain their original definitions and values.

The starting **Status** property offers **Later, Now, Doing, Blocked, Done, Skip, and Cut**, with Later as its creation default. Skip represents a routine task that is irrelevant for the current review; Cut represents intentional abandonment. One property may be designated as the lifecycle property, with option behaviours Normal, Completed, or No calculated effort; choosing None disables lifecycle-derived behaviour. Status initially owns that role, with Done completed and Skip/Cut earning no calculated effort. Property values and dashboard inclusion are independent.

Completing children never automatically completes their parent. Changing a parent's status never rewrites its children's statuses. Broad topics and ongoing projects can have lifecycle annotations even when overall completion has no useful meaning.

Project journals, blockers, and rough next-step plans may remain in project-level notes rather than becoming child Items. Items can be created quickly at specific locations and moved within the hierarchy.

A red trash icon ends the shared Item controls in the title row and each child row. Deleting an Item removes it and its descendants from the current hierarchy after confirmation. Historical snapshots remain unchanged. Cut retains an abandoned Item in the current hierarchy; deletion does not require a recycle bin.

The Item path ends in an inline editable title. Shared controls in the title row and Children rows appear in this order: Hidden when applicable in the title row, inclusion checkbox, inline property picker, allocation percentage × effort percentage, and a red trash icon. Percentages have no visible field titles, retain accessible labels, and display rounded whole numbers without rounding the saved value. A tap focuses text entry; vertical dragging adjusts by roughly 100 percentage points per 300px and shows a vertical-resize cursor. Allocation stays within 0–100%; effort may exceed 100%. Clearing effort restores calculated mode, whose value is gray when unfocused. New Items default to blank automatic allocation; numeric allocations are optional overrides. Clearing or right-clicking an allocation input restores automatic mode: blank allocations divide the remainder after explicit allocations equally, with the calculated percentage shown in gray when unfocused. Child rows use compact spacing and drag reordering without up/down buttons. Child names edit inline on click, save on blur or Enter, and cancel with Escape. A separate Open icon navigates to the child. The compact Properties section edits every field. Inline and child bulk pickers follow the active view’s property, while Item settings contain parent and default-prompt selection. Hide finished hides children whose designated lifecycle option is Completed or No calculated effort, even when they have a manual assessment. Prompt management is accessed through the global Settings cog rather than a separate Item-level button. Items without children offer a compact Add child action that reveals the entry field. In populated Children lists, selection enables bulk deletion with confirmation of the selected children and descendant count; it affects the current hierarchy only. The Notes toolbar keeps common formatting and Markdown mode visible, with less-used formatting, inserts and widgets under an overflow control.

## Dashboard selection and allocation

The current dashboard selects Items from the persistent hierarchy. Hidden Items retain their current content and context. The ordinary UI presents one current version of each Item; historical versions are reached through historical views.

Size declares intended relative attention, effort, or energy. It is not duration, an objective measurement of work, or project completion. There is no time tracking.

Allocation is local to visible siblings within a parent. An Item's overall share is derived through its ancestors. Resizing a topic changes its footprint while preserving its descendants' relative allocations. It must not require rewriting allocation values across potentially hundreds of descendants in that topic or other topics.

Blank allocations divide the remainder after explicit allocations equally among included automatic siblings: 40%, blank, blank yields 40%/30%/30%. While other included automatic siblings remain, editing a percentage fixes that Item’s explicit share and recalculates the blanks; other explicit shares remain unchanged. An explicit edit cannot exceed the available remainder, and drag controls stop at that limit. A numeric edit or drag leaves automatic mode. When all included siblings have explicit allocations, reallocating an Item proportionally scales all other included siblings, preserving their relative proportions: increasing the first share in 50/30/20 to 60 produces 60/24/16. Existing allocations retain their proportions until edited; snapshots retain both the allocation mode and values. If inclusion or hierarchy changes overfill a mixed group, explicit shares are fitted proportionally to 100% and blanks receive zero.

Allocation handles always begin on the Item's clockwise-most edge, including for the last sibling. Dragging uses virtual angular space that can extend beyond the parent's region: displacement from the initial pointer position adjusts the initial allocation, clockwise to increase and counterclockwise to decrease. The gesture remains attached to the original Item as the layout changes. The actual slice boundaries follow the resulting proportional allocation and need not coincide with the pointer. A live allocation readout provides feedback; no side-dependent handle behaviour is required.

Hiding a child redistributes its share among remaining visible siblings using the allocation rules above, without changing the parent's share. Hiding a parent suppresses its branch. Restoring it recovers the prior descendant selection and relative allocations. Recovering these values from the last dashboard where the parent was visible is an acceptable simplification; never-seen-before children may default to selected with an even share. The representation is open.

Large branches need efficient inclusion and exclusion controls. The child table and a dashboard-wide **Show all** toggle expose hidden Items for browsing and selection. Show all may give hidden Items arbitrary display shares and disable resizing or other allocation-dependent functions. Its temporary geometry must not change real membership, allocations, or effort calculations, and hidden Items should be distinguishable from included Items.

## Effort assessment

Effort is assessed for the period against current, editable intent. **100%** means the intended effort has been spent; values above 100% represent overinvestment. It does not measure overall project completion or establish an absolute quantity of effort.

The shared rules are:

- A leaf defaults to 100% when its designated lifecycle option has Completed behaviour, and 0% otherwise, unless manually assessed.
- A parent defaults to the allocation-weighted average of its visible children's effort assessments.
- A manual assessment at any level replaces that Item's calculated assessment, without changing descendants. An Item with no visible children can be assessed directly.
- Effort flows only from child to parent. An overridden parent's assessment contributes upward, without separately counting the children it overrides.
- No calculated effort behaviour gives an Item 0% calculated effort, including when it has children; its descendants remain unchanged. The starting Skip and Cut options use this behaviour. Included Items retain their denominator weight; hidden Items are excluded. Manual assessments override lifecycle behaviour.
- Resizing an Item does not change its manual effort percentage. Reweighting children does update their parent's calculated assessment.

The Planned snapshot is a historical reference, not an enforced denominator. Hiding unfinished work can legitimately increase checklist-derived effort by reducing intended scope. The application relies on honest reassessment as priorities change.

For example, two equally weighted visible activities at 150% and 50% yield 100% calculated parent effort. A manual assessment of that parent replaces this result without distributing anything back to the activities.

## Main workspace

### Property filters

A shared Filter popup works across Sunburst, Kanban and Outline, independently of colouring, grouping and sorting. Every configured property has a row of value toggles, including Unset; all values start enabled. A tap switches a value off or on immediately while the popup stays open. Each row has All and None shortcuts, and Reset all restores the unfiltered view. The creation default is marked on its value. The toolbar badge counts disabled values. There are no rule-building or Apply steps.

An Item must have an enabled value for every filtered property. Filters use each Item's own values, without inheriting a parent's property. They persist in the URL across switching views, opening details, refresh and browser Back. Missing properties and removed options are ignored against the displayed workspace or snapshot's definitions. Filters only affect presentation: inclusion, allocations, effort calculations and snapshot data remain unchanged. Sunburst Show all and Outline All Items / Dashboard only retain their separate inclusion meanings.

Sunburst retains ancestors of matching Items for navigation and dims their labels when they do not themselves match. Remaining slices fit the available space, with real local shares and effort retained in readouts. The filtered view is labelled, and wheel allocation dragging is disabled until filters are cleared. Numeric editing in Item details and Outline still uses the full dashboard. The compact Kanban navigator uses the same filtered hierarchy.

Kanban filters its existing eligible cards without promoting a parent when all of its cards are filtered out. Card sizes and parent paths retain their original meaning; empty columns disappear while property filters are active. Outline combines property filters with title search, reveals matching descendants through collapsed branches, and retains nonmatching ancestors as context. Clearing filters restores the prior expansion state. Filtered context rows remain editable but are excluded from bulk selection; Select shown rows and Select branch only select matching Items while property filters are active. New filters cancel pending drags, and filtered Outline drops move into a parent rather than positioning against an incomplete sibling list.

### Sunburst

The sunburst presents a zoomable hierarchy with importance expressed by angular share and effort by radial fill.

- Angular size communicates intended allocation.
- Color by selects a property whose configured option colours colour the wheel and cards; None uses a neutral colour. The starting Status colours use muted orange for Now, blue for Doing, green for Done, and neutral tones for Skip.
- Radial fill communicates effort against intent.
- Above 100%, a second, more intense radial fill layer shows excess effort. The visualisation caps at 190%, preserving contrast between the two layers. Stored effort is not capped at 190%.
- Clicking or tapping any Item opens its details without changing wheel focus. Double-click on desktop zooms into an Item with visible children; Items without visible children open details. Right-click or long-press opens the same Item actions menu. The center opens the focused Item, a separate ↑ parent control zooms out, and the overview map returns to the root.

Mobile wheel interactions use explicit modes:

| Mode | Interaction |
| --- | --- |
| Navigate | Tap any slice to open its full-screen Item view; long-press any slice for its actions menu, including Zoom in. |
| Importance | Drag directly on a slice or its clockwise-edge handle to adjust allocation, without a preliminary selection tap or opening its page. |
| Effort | Drag directly on a slice or its handle to adjust effort radially, without a preliminary selection tap or opening its page. |
| Create | Show a phantom “+” child for every Item represented in the wheel view; tapping it opens a naming form for a new child under the associated Item. |

Desktop mouse use defaults to **Omni**: click opens any Item, double-click zooms into branches with visible children, and small importance, effort, and add-child controls remain visible on the represented Items. Opening details briefly waits to distinguish a double-click; dragging a handle highlights the Item without opening its pane or moving the wheel. Importance controls remain unavailable in Show all, and historical read-only views expose navigation without editing controls. Navigate combines opening and zooming under the pointer icon: tap opens details and a stationary long-press opens its actions menu on touch; click opens details and double-click zooms on desktop. Touch defaults to Navigate, and selectable Omni uses these same gestures. Enter opens details and Shift+Enter zooms for keyboard access. Movement or cancellation cancels a pending long-press. Importance, Effort and Create remain separate modes. The compact right-click and long-press menu lists Open details, Included on dashboard, Move, and Zoom in before a separator and the active property’s options, including unset. Move opens a modal with a parent selector and explicit Move/Cancel actions; destinations include the workspace root and exclude the Item and its descendants. Zoom in is available for branches with visible children. Long-press never zooms directly. Historical read-only views disable inclusion, moving, and property changes while retaining navigation.

Omni shows no dashed allocation or effort guides, which would obscure titles. In Importance and Effort modes, mouse hover reveals the relevant handle. Visible drag handles are about 25% smaller than the original controls, while direct slice dragging avoids requiring a small target. A tap without a drag does not change allocation or create an effort override.

The wheel uses the available window space, with no reserved workspace circle in the overview; focused branches retain a central Back control. Compact Topic sectors leave room for wider outer layers, and leaf sectors extend through unused outer space. Titles default to outward-aligned radial text, with short overview Topic names treated compactly. The global Settings cog groups Workspace and properties, Top-level Items, Prompts, and Sunburst display controls. Display controls cover radial titles, preferred/minimum font sizes, label and outer-edge padding, truncation threshold, visible depth, and relative layer widths. Unsaved phone defaults use a 5px minimum font and 1px label and outer-edge padding; desktop defaults and saved preferences remain unchanged. Numeric fields allow an empty draft while typing and commit on blur or Enter. Settings sections start collapsed. Sunburst display preferences persist in browser local storage and can be reset. Workspace configuration and top-level Items persist with the server workspace. Small slices still require zooming to read fully.

Effort dragging is radial, matching the fill direction: movement outward increases the starting assessment and movement inward decreases it. It uses displacement from the drag's initial position rather than angular movement. The assessment changes continuously through 100% and can exceed the 190% visual cap, with a live numeric readout. Dragging creates a manual assessment; the control for restoring calculation from children remains available.

Phantom children are temporary creation controls, not Items: they have no real allocation, effort, or historical state. Creating a child is distinct from reordering existing Items. The active mode is explicit, with a straightforward return to Navigate mode; numeric allocation and effort controls remain available for precise editing.

The creation form identifies the parent and focuses title entry. The pop-up reuses the compact inclusion, property, allocation × effort controls and exposes all fields under Properties. Properties use their configured creation defaults, with explicit unset available. Inclusion defaults to enabled, and allocation and effort to blank automatic values; neither percentage is required. Submitting appends the child after existing siblings with any chosen overrides. It returns to the wheel in Create mode for further additions. Cancelling leaves no empty Item; opening the new Item's full notes is a separate action.

The current dashboard also supports Show all as described above. Exact colours, styling, and small-segment presentation remain design choices for prototyping.

Opening the application's home URL shows the current period's wheel with this client's saved property filters. Filters are saved in local storage and restored on startup when the URL does not specify filters; explicit URL filters take precedence, including an explicitly empty selection. Reset all also resets the saved preference. Direct Item links open their target; refreshing and browser Back preserve the view represented by the URL.

### Kanban execution view

The workspace switches between Sunburst, Outline and Kanban. Kanban provides an execution view. A compact sunburst uses the same gestures: click or tap any Item to open details while preserving board focus, double-click a branch to zoom the board to it, or right-click/long-press for the same actions menu. Its navigation lists the workspace name and every ancestor as upward links, the clickable current Item with an adjacent Open action, and included immediate children that themselves have children. Leaf children are omitted from this branch navigation. One toolbar combines the view switch, wheel modes, Show all and period controls, with the view switch at the far left. View and mode switches use icons on phones, and Show all uses an eye toggle. A compact period selector shows the current phase. Its popup starts with Planning » Active » Next; Active captures planning and Next opens rollover. The + New toolbar action in both views opens the shared creation popup at the current focus, including top-level creation from the workspace overview. Clicking empty main-view background dismisses Item details in either view, while clicks on Items and controls retain their own actions. The wheel has no surrounding panel frame or legends. The board shows effectively included descendants of that branch only when they have no included immediate children; it excludes the focused Item itself. Parents with included children remain available through navigation and parent-path headings, without a duplicate card. An included parent whose children are all hidden, or which has no children yet, remains a card. This presentation rule also applies to Topics at the overview and does not change inclusion, allocation or effort. A hidden ancestor suppresses its branch. The board view and focus participate in URL navigation, refresh and browser Back, including when opening Item details.

Group by chooses the board’s property independently of Color by. Columns follow its configured option order and include an unset column; None shows one ungrouped column. The starting Status order is **Now, Doing, Blocked, Done, Later, Skip, Cut**. Columns group values rather than enforce a required sequence. Cards in each column are grouped by immediate parent, with a shared parent-path heading and a subtle connecting rail. Compact column headers, quiet tinted backgrounds and plain cards follow the supplied Notion reference.

Cards show only their title, without inline percentages, status menus, focus buttons or drag grips. Right-click or a stationary long-press opens the shared compact Item actions menu, with actions before the grouping property’s options. Shift+F10 or the Context Menu key opens it from a focused card. Moving the pointer, cancellation, or leaving the board focus cancels a pending long-press; opening the menu does not open details or drop the card. Dragging can begin anywhere on a card; after a small movement threshold, a matching floating card follows the pointer while a faint placeholder retains its original space. A click or tap without dragging opens the Item. A drop on a column or group background changes only the grouping property without reordering; dropping in the unset column clears that value. A drop explicitly before or after a sibling card in a matching parent group also reorders within that parent, whether or not the grouping value changes. Drops on unrelated groups never reparent an Item or imply sibling order. Reordering includes the full sibling list, retaining the relative order of siblings hidden from the board or in other columns. There is no default importance sort.

Card height and font size vary with the Item's share relative to the focused branch, bounded for readability. An initial height formula near 32px plus share × 320px is a starting point for visual tuning, not an exact requirement. Shares still follow the full allocation hierarchy, including parents omitted from the board. Titles may grow a card beyond its nominal size to avoid hiding content. All property values remain editable in Item details, which retain the existing responsive pane/full-screen behaviour.

### Outline planning view

Outline is a third main view for triage across the whole workspace. It displays an indented hierarchy with Topics initially expanded to their immediate children, independent branch expansion, and Expand all / Collapse all. Expansion, search, selection and scroll position survive opening details and switching views within the loaded period. Opening details uses the existing pane or full-screen layout; Back returns to the outline. The view participates in URL navigation, refresh and browser history. Outline shows the entire workspace independently of the wheel or board focus.

All Items is the default; Dashboard only shows effectively included Items. Rows are subtly tinted by the active property value. Effectively excluded Items, including those hidden by a parent, use a lighter tint and muted italic titles instead of visibility subtitles. The inclusion checkbox retains the Item’s local setting; its tooltip distinguishes local exclusion from hiding by a parent. Collapsing and filtering never change inclusion. Search matches titles and retains matching Items' ancestors, temporarily expanding their paths without overwriting saved expansion.

Rows support inline title editing, the active property's picker, inclusion, allocation, effort and confirmed subtree deletion. Allocation is always the real local share within the parent, even in All Items; included Items remain editable without the sunburst's temporary Show all geometry. Gray percentages are automatic. Open is separate from title editing. Narrow layouts use compact two-line rows with controls directly beneath the title and no required horizontal scrolling. Mobile chrome uses a compact global toolbar and a single-row Outline toolbar without a repeated workspace heading. There is no persistent row-count footer or allocation hint; selection mode alone adds a compact bottom bar, with bulk actions opening above it instead of reducing the tree viewport. Arrow keys navigate rows and expand/collapse branches; Enter opens details and F2 edits the title.

Add child on any row reveals an indented entry beneath that parent. Enter creates with the normal defaults and leaves the entry ready for another child; Escape dismisses it without creating an empty Item. The outline toolbar also provides inline top-level creation.

Dragging starts only from the row's handle. Dropping onto a row reparents the entire branch; dropping near the top or bottom inserts before or after the target at its indentation. An explicit highlight and destination text distinguish these actions. Hovering over a collapsed destination expands it after a short delay. Escape cancels dragging, and self/descendant destinations are forbidden. Under a search or sort override, drops only reparent and do not show insertion markers. The searchable Move to dialog provides the same destination choices, including the workspace root, for keyboard, touch and distant moves.

A move is atomic, with the normal allocation recalculation in affected sibling groups. One-level Undo restores placement, order and allocation values exactly, while preserving subsequent notes, properties and effort edits. Undo becomes unavailable when the hierarchy, inclusion or allocation changes. Moving reveals the destination, clears the search and switches to All Items so the moved branch remains inspectable.

Select mode introduces selection checkboxes separately from inclusion. Selecting a parent selects only that row; Select branch explicitly includes all descendants, including hidden or collapsed ones, subject to active property filters. Select shown rows selects matching rows in the current search/expansion results, excluding ancestors shown only for context. Bulk controls include Include, Exclude, Set property, Move, Allocation to Auto and Effort to Auto. When moving a selection containing both a parent and its descendants, descendants travel with that parent instead of becoming siblings. Historical views retain browsing and expansion, disable edits until correction mode is enabled, and never offer deletion.

### Item details and child table

A resizable detail pane presents an Item's notes, widgets, and immediate children on wide layouts. It can expand to give editing or widget interaction most of the available space. On narrow layouts, including intermediate widths where a useful side-by-side arrangement does not fit, opening an Item replaces the wheel with a full-screen Item view. The wheel must not remain stacked above it occupying most of the viewport.

Within the Item view, Children appear first and Notes follow vertically in one scrolling view, without separate Children/Notes tabs. Keep section headers compact and avoid UI subtitles or explanatory taglines. Section framing should consume little space.

Navigating to a child from the Item view opens that child in the same full-screen space. These view changes participate in browser history: Back returns to the previously viewed Item or wheel, including its prior focus. Use native browser navigation rather than implementing a competing edge-swipe gesture. The sunburst does not support reordering; sibling reordering belongs in the list/table view.

Notes use a Notion-like, Markdown-esque rich editor supporting text, images, links, and tables. Notes can contain links to other Items and embedded interactive widgets.

Pasted or dropped images become application-managed attachments stored in a directory alongside the database and referenced through Markdown links. They do not depend on the original file location. Images referenced by historical snapshots remain available; automatic attachment cleanup is outside the initial scope.

Widgets are configurable Markdown extensions embedded within Item notes. A widget can present a virtual view, such as a live directory listing, without making its displayed entries child Items. The extension representation should accommodate nested parameters for future widgets; the exact syntax and editor controls remain design decisions.

Use MDXEditor for visual and source editing, with Markdown-style note storage. Extension syntax remains to be selected using the editor's existing facilities. The agreed rich-note capabilities remain required.

The notes UI provides both visual editing and direct editing of the underlying Markdown text. Source mode supports configuring extensions and repairing malformed or broken blocks; it is a required part of the editing experience.

Unsupported or malformed extension content may use the chosen library's conventional fallback presentation. The underlying source remains available for repair; no particular per-block error UI or automatic repair mechanism is required.

Notes use a short autosave debounce. The Notes heading shows Saving or a save error while applicable, but hides the idle Saved indicator. The agent prompt link and selector sit at the right of this heading, after the save indicator. Saving on navigation or browser backgrounding is best effort. Offline save queues, draft recovery systems, and guaranteed background delivery are outside scope; revisit only if actual use exposes a problem.

The immediate-child table uses the same active-property background tints and lighter, italic treatment for effectively excluded Items as Outline, without per-row Hidden labels. It should be compact and carefully laid out, with drag-and-drop sibling reordering, convenient lifecycle dropdowns, and a checkbox for inclusion on the current dashboard. Allocation and effort are also directly editable in the table. A narrow-screen row can use two compact lines to avoid forcing horizontal scrolling. It includes hidden children. The table and sunburst operate on the same Items and dashboard state.

Global search matches current Item titles, including hidden Items, and displays the parent path for context. Full-note search and historical search are outside the initial scope.

## Periods and historical views

Periods advance explicitly through rollover, not through a recurrence schedule. A period has these checkpoints:

| Checkpoint | Capture |
| --- | --- |
| Opening | The new dashboard as copied from the preceding dashboard at rollover. |
| Planned | The state when “Planning is finished” is clicked, if that happens. |
| Closing | The final state when the dashboard is closed through rollover. |

Rollover captures Closing for the old period, copies the dashboard unchanged, and captures Opening for the new period. Selection, allocations, property values and definitions, and effort assessments carry forward. Clearing assessments, resetting routine Items to their lifecycle property’s configured creation default, or hiding completed one-offs are explicit planning actions, supported by convenient bulk actions or widget buttons. Clearing a manual override returns to calculated/default behaviour; routine statuses can be reset separately.

A period can close without a Planned snapshot. No retroactive planning step or fabricated checkpoint is required. The current dashboard remains editable after planning finishes.

The period menu offers **Reset properties…** on the current dashboard. A separate modal applies to all current Items, including hidden Items and descendants. Return effort to Auto and Return importance to Auto start checked each time; each configured property has an unchecked reset checkbox and an option picker initially showing its creation default. Pickers offer Unset and every option, marking the configured default. The dialog shows per-action change counts and a unique total; confirmation is disabled when no Items would change. One confirmation applies all selected resets atomically. Cancel or Escape discards the selections, and errors leave the dialog open. Historical snapshots remain unchanged. Automatic effort still follows lifecycle and child calculations; it is not necessarily zero.

Historical views retain the checkpoint's Item titles, hierarchy, notes, allocation, effort assessments, property values, and visibility, together with its workspace name, property labels, option order and colours, defaults, and lifecycle role. Later changes to current Items or workspace configuration must not silently change historical presentation or calculations. Workspace configuration is edited only on the current dashboard. This is a behavioural requirement; copying, revision references, commit references, and other storage methods remain unspecified.

Historical corrections are for fixing mistakes. A correction affects only its selected snapshot. Later snapshots and the current dashboard remain unchanged, including content originally inherited from the corrected snapshot. They can be corrected separately. A user-facing branching-history model is unnecessary.

**Low-priority preference:** historical recovery of hidden Items' content and state is desirable, but may be omitted if it fits the chosen data representation poorly. Preservation of the displayed dashboard's historical content remains required. Transient external widget listings need not be archived.

## Deployment and device access

The application runs as a standalone Node server or a macOS Apple Silicon Electron app. The desktop app stays in the menu bar and shows its Dock icon while any workspace or connection-settings window is open, including when minimized. The Dock icon disappears when all windows are closed or hidden. It can host a local workspace or connect to an existing Life Manager server. Desktop and browser clients can use the same workspace simultaneously through one owning server; they do not maintain separate database copies.

Closing a desktop window leaves the app and its local server running. Explicit Quit stops an app-owned server and leaves independently running servers alone. The connection screen selects a local data directory or an existing server address. On macOS both desktop and standalone server default to the workspace directory under Life Manager's OS application-data directory, outside source checkouts. Existing workspace directories can be opened in place with explicit configuration. Local network access is opt-in. Desktop and mobile browsers can access a shared server through a trusted network while its host is awake. Public internet hosting, multi-user authentication and remote host-runner design remain outside scope.

The iPhone-capable version must support the full application, including sunburst allocation, hierarchy and selection controls, rich notes, period operations, and widgets. Touch interactions may differ from desktop gestures while providing the same capabilities. A reduced mobile feature set is not the target.

This is an ordinary online web application. It need not work when its server is asleep or unreachable. PWA functionality, offline editing, and client-database synchronisation are outside scope.

Server-side actions can run directly on the application server; a remote action runner is outside the current scope. Opening something on the viewing device and triggering an action on the Mac remain distinct operations.

## Extensibility

### Send an Item to an agent

Preparing an Item for an agent with a reusable prompt is a core application action. Settings → Prompts selects how this client handles prompts. The default opens a modal showing the full interpolated prompt and context, with a Copy prompt button. Codex opens a prefilled composer in its installed GUI. T3 Code copies the full prompt to the viewing device’s clipboard and opens a blank conversation, with a small popup reporting the result and asking the user to paste and submit. Browser clients launch T3 on the Life Manager server; the Electron app uses its main process to copy and launch on the client computer, including for remote server connections. The T3 Code location field saves an optional app bundle or CLI executable path per client and across restarts; blank means automatic detection. Its path belongs to the launching computer. Preparation never launches an app. A dropdown offers a small set of saved prompt templates, preselected using the nearest ancestor with a configured default prompt. The prompt is an automatically prepared inline action: its text opens the dialog or selected app, while its chevron or surrounding control opens the template picker. The user can choose another template for the invocation. Template interpolation always refers to the selected Item, not the ancestor supplying the default, and supports its name, URL and ID so the agent can inspect and act on its context.

Templates and ancestor default references are persistent configuration. The selected storage, placeholder syntax and Codex adapter are described in [docs/REFERENCE.md](docs/REFERENCE.md#agent-prompts). Dispatch does not automatically change lifecycle status or effort; any requested Item operations belong to the prompt's task. A language-game template can ask Codex to follow the launch-steam-game skill and close its task after success. Task-closing behaviour is template-specific.

The handling preference is stored per browser or desktop client; saved templates remain workspace configuration. Codex uses a browser-followed `codex://` link containing the prepared prompt. The user opens it on the viewing device and submits it in Codex. Codex dispatch has no persistent GUI dispatcher, server queue or server-side application launch. T3 launch uses the launching computer’s Life Manager working directory: the server’s agent directory for browser requests, the local workspace directory for Electron local hosting, or a local Life Manager directory for Electron remote connections. Remote Electron prompts use the connected server’s API address and an accessible API-skill reference, rather than server-local paths. Copy and launch failures remain distinguishable, and no prompt is submitted automatically. New-task host selection and iPhone link handling depend on Codex; neither is assumed to work.

The dispatched agent needs access to the referenced Item. Mac-specific actions depend on the Mac being available. This action does not require a separate activity plugin.

### Widgets and shared operations

Widgets can render arbitrary HTML or the rich Markdown-like format used by notes, with links and buttons invoking server-side actions. These actions can create or update Items, change statuses, run command-line commands, and open external applications on the appropriate host.

Widgets and local agents share a callable interface for ordinary application operations, including reading Items, editing notes and statuses, arranging the hierarchy, changing allocations and selection, editing effort assessments, and managing period checkpoints. API endpoints and command formats are documented in [docs/REFERENCE.md](docs/REFERENCE.md#shared-api).

Page-specific code can be bespoke and tightly coupled. Editing that code and restarting the application is acceptable. No dynamic plugin installation or hosted agent system is required.

A live feed can exist inside an Item page without creating Items for its entries or adding them to the dashboard. A widget may offer direct use of an entry or an explicit action that creates a persistent Item. These behaviours belong to individual widgets, whose capabilities are deferred.

All dynamically created Items default to dashboard inclusion enabled. Property values use the workspace’s configured creation defaults; the local-directory and Twitch widgets create children of their owning Item.

The initial activity widgets are grouped live followed Twitch channels and local video listings, specified in [PLUGINS-PRD.md](PLUGINS-PRD.md). Names come directly from source fields: channel name for Twitch and file stem for videos. Link-title cleanup is unnecessary; newsletters are excluded from the first version. Launching learning environments can use the core agent action.

Video playback, serving video files, and hosting an agent that arranges windows belong to external applications. The platform supplies the means to invoke them.

## Data access and scope boundaries

Snapshot data must be accessible to external processes for later analysis. Specific reports, formulas, and reporting UI are deferred until real usage data exists. Reports can be produced and viewed entirely outside the application.

Built-in importers and migration-specific APIs are excluded. One-off external scripts may use ordinary application operations or write directly to the database during offline migration. SQLite is the selected storage; the schema is described in [docs/REFERENCE.md](docs/REFERENCE.md#storage). There is no requirement for a general interchange format or compatibility framework across alternative implementations. If a later migration is needed, it can be planned against the actual databases and content.

Other excluded requirements are time tracking, built-in reminders or recurrence, automatic status propagation and multi-parent Items. Configurable properties are limited to single-choice fields. Regular dashboard visits provide the reminder by exposing looming obligations alongside other pursuits.

## Delivery workstreams

Data inventory and activity-plugin scoping proceed together: reviewing sources should also establish the intended workflows. This workstream identifies the material to retain and its organisation, prepares a single database seed file when the inputs and schema are settled, and produces the separate plugins PRD.

The application workstream designs the standalone web application and assesses reuse of the existing BB implementation. The core application is tried before implementing the activity plugins and polishing the UI. Alternative platform implementations are deferred unless experience gives a reason to switch.

## Behavioural evaluation

Tool evaluation and prototypes should exercise the following scenarios. They are product checks, not a prescribed automated testing architecture.

- Record a complex Tend undertaking's notes and intermittent next steps, then resume it without reconstructing its context.
- Hide a Build project with a selected subset of children and later recover that selection without manually rebuilding it.
- Resize a top-level topic while preserving descendant relative allocations; reweight visible children and see calculated parent effort change correctly.
- Enter an effort override above 100% at a parent and observe it flow upward without changing descendants; retain a value above the sunburst's visual cap.
- Show hidden Items temporarily without changing selection or calculated effort, then edit inclusion through the child table.
- Roll over unchanged, perform explicit planning resets, capture Planned when desired, and later inspect all available checkpoints with their historical notes and hierarchy.
- Add a property with a creation default, verify existing Items remain unset, and group and colour by different properties without changing lifecycle calculations.
- Rename or remove an option after capturing a snapshot and verify its historical labels, colours and effort remain intact.
- Correct one historical snapshot and verify that later snapshots and current content are unaffected.
- Invoke a local server-side action from a widget or agent and access historical data externally, without requiring the application to host the external activity or its report.

The dashboard toolbar provides a temporary sort override for each view: Order, the active property, Importance or Effort. Order restores the saved sibling sequence. The property sort follows its configured option order, with unset last; importance uses effective allocation including automatic shares, and effort uses calculated/overridden effort percentage, both highest first. Sorting preserves hierarchy and Kanban parent groups, with saved order breaking ties. Kanban columns retain the selected Group by property. Overrides are session-local presentation choices and do not alter Item orders or snapshots. While a Kanban override is active, drops may change the grouping value but never reorder siblings or display insertion markers; Order restores manual reordering. The Children table retains its saved order.

## Current phase

- Desktop: personal macOS Apple Silicon app with a menu-bar presence, a Dock icon while windows are open, local workspace hosting, existing-server connections and simultaneous browser access. Locally built application bundle; distribution signing and automatic updates are deferred.
- Phase: public MIT-licensed application with a browser-only interactive demo for GitHub Pages. Workspace names, top-level Items and single-choice properties are configurable, with independent colouring/grouping and snapshot-preserved configuration.
- Browser demo: reuse the SQLite planning model through WebAssembly and persist temporary changes in IndexedDB. Warn on entry that there is no export and browser storage may be cleared. Host integrations remain available only in the server application.
- Publication boundary: keep runtime data, credentials and private imports out of source control. Documentation media uses only the synthetic demo workspace.
