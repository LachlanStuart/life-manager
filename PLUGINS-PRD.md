# Life Manager activity plugins

Activity-plugin scope for the standalone application. [PRD.md](PRD.md) owns the shared Item model and application behaviour.

## Tend routines

A dedicated routine-reset button is out of scope. Recurring Items remain under `Tend → Routines`, with their statuses editable through ordinary application controls. Completed routines are retained for reuse.

## Language activities

Language activities can be organised by language and media type. Reading, games, videos and exploratory resource lists are ordinary Items with notes; this organisation does not require a specialised plugin.

Activity launch uses the [core Send an Item to an agent action](PRD.md#send-an-item-to-an-agent). The main PRD owns prompt selection, ancestor defaults and interpolation. A deployment may supply a reusable launch prompt and its own agent skills. Those skills are external integrations, not bundled dependencies.

Example prompt:

```text
Read {{item.name}} at {{item.url}} (ID: {{item.id}}).
Help me start the activity described in its notes using the tools available on this host.
```

Launch discovery and verification remain the delegated agent's responsibility. A link or inventory entry does not establish that an application is installed on the host.

## Local video listing

A configurable Markdown extension inside an Item's notes renders a virtual, live listing of the immediate files and folders under a configured local directory. It does not walk recursively or browse inside subdirectories. Its Markdown configuration sets the root and exact directory names to exclude, for example `Watched`. Both files and folders are eligible for conversion to Items. The Markdown extension representation must accommodate nested parameters for future widgets without prescribing a syntax here. **Create Item from listing**, defined in [CONTEXT.md](CONTEXT.md), creates a persistent Item referencing a selected file or folder so its notes can record why it is appealing to watch.

| Aspect | Agreed scope / open decision |
| --- | --- |
| Inputs | Current directory contents on the application server. |
| Persistent configuration | Listing root and exact directory-name exclusions on the Markdown widget in the owning Item's notes. Only immediate children are listed. Saved Items retain a file URL in the core `resourceUri` field. |
| UI actions | View the virtual listing within notes; choose Create Item from listing for a file or folder; edit the resulting Item's notes. A folder produces one Item referencing that folder, without importing its contents as children. Files can be selected separately. |
| Item operations | Create a child of the widget owner with configured property defaults and dashboard inclusion enabled. Name video Items using the file stem (filename without its final extension); folder Items use the directory name. Unselected listing entries remain transient. A referencing Item suppresses the file/folder from the listing unless its designated lifecycle option has complete behaviour, or it has the built-in Cut value while Status is the lifecycle property. Skip does not release a reference. |
| Host dependence | Directory access is local to the application server. Remote hosting and runner design are deferred under the main PRD. |

Video playback remains external. Whether a saved video Item invokes an agent prompt, and what that prompt does, remains to be specified. The live listing reads only the configured directory; no bulk video import is performed.

A file/folder remains eligible for the listing when it has no referencing Items or all its referencing Items qualify as complete or Cut as defined above, provided it still exists under the configured root and passes exclusions. Creating an Item from that entry again creates a new viewing intention; it does not reopen a previous Item. Watched or definitively abandoned files are moved out of the directory by the owner; moving them is not an automatic widget action. Dashboard exclusion does not release an otherwise active reference. References are matched across all current Items, including hidden Items and Items created through other widgets. Historical snapshots alone do not suppress current listing entries.

## Live followed Twitch channels

A Markdown widget requests the account's currently live followed channels through the Twitch API and arranges them by configured streamer group. Curation is the Twitch follows list; a separate curated channel list is unnecessary. [Twitch Live Extension](https://github.com/PedroS11/twitch-live-extension) is a reference for the account-login and live-follows listing workflow, not a requirement to reproduce its notifications or discovery features.

Groups are configurable, for example Gaming, Creative and French. Group definitions derive from the membership mapping rather than a hard-coded category list. Unmapped channels appear in Ungrouped. A group collects channels/streamers; these are equivalent terms in this workflow, not separate entities. Per-channel assignments and group ordering are configured in each widget.

| Aspect | Agreed scope / open decision |
| --- | --- |
| Inputs | Authenticated account's live followed channels from Twitch. |
| Persistent configuration | The Markdown configuration stores the public Client ID, channel-login-to-group mapping and group order. Account authorisation tokens are private server data, separate from notes and dashboard snapshots. Streamer groups are user-defined, distinct from Twitch's game/content categories. |
| UI actions | Show Channel, Title, Game/Category and elapsed stream duration, arranged by streamer group. Clicking a channel opens its Twitch page directly for preview, without creating an Item. Explicit Item creation is separate from that link. Mappings and group ordering are edited in the widget's Markdown configuration. |
| Item operations | Each explicit create action always creates a new child of the widget owner, using configured property defaults and dashboard inclusion enabled, named after the channel. Do not look up, reuse or open an existing Item. It is an ordinary Item with a Markdown channel link in its notes and no special Twitch-derived click behaviour. The changing stream title is not the Item name. |
| Host dependence | Twitch network/API access and account authorisation are required. Fetching runs on the application server; viewing actions may target the viewing device or server host. |

The [Get Followed Streams API](https://dev.twitch.tv/docs/api/reference/#get-followed-streams) supplies `user_name`, `title`, `game_name` and `started_at`. Display elapsed stream duration by subtracting the broadcast start time from the current time; omit it if the timestamp is unavailable. This is broadcast duration, not user time tracking.

Existing Items do not suppress channels from the live Twitch widget. Its listing is determined by live followed channels, independently of Item creation.

## Scope exclusions

Newsletters are excluded from the first version. Link-title cleanup is unnecessary: use reliable source name fields rather than a cleanup plugin or agent prompt. Tools to try is an Item hierarchy; its links do not by themselves require a plugin. No generic importer, migration API, or interchange format is needed.

## Application coordination

- Adding widget blocks preserves existing notes and does not change earlier snapshots.
- External resource links should have browser-usable destinations on mobile as well as desktop.
- Widget configuration uses the existing `life-widget` JSON fence in Markdown. The shared Item `resourceUri` field records video references.
- Coordinate template storage, any ancestor default reference, Item URL/ID access from dispatched agents, and saved file/folder references with the core design. These specific needs do not imply a general custom-property system.
- Launchers can operate directly on a locally hosted deployment. Remote hosting and runner design are deferred. Full mobile application functionality does not imply that desktop activities execute on the phone.
