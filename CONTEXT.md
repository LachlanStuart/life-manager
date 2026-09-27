# Life Manager

Life Manager organises personal pursuits and supporting knowledge, makes intended attention explicit, and preserves periods for reflection. [PRD.md](PRD.md) owns the product behaviour and current direction; this document defines the shared vocabulary.

## Language

**Topic**: One of the four broad personal efforts: Tend, Build, Learn, and Enjoy.

**Item**: A place in the hierarchy with a lifecycle status, notes, and optional child Items.

**Lifecycle status**: An Item’s manually controlled annotation using Later, Now, Doing, Blocked, Done, Skip, or Cut.

**Skip**: The status for a routine Item that is irrelevant for the current review.

**Cut**: The status for an Item intentionally abandoned.

**Dashboard**: The selection and arrangement of Items expressing intended attention within a period.

**Dashboard inclusion**: An Item’s membership in the attention plan, distinct from temporary display in Show all mode.

**Intended share of attention**: The relative allocation of attention, effort, or energy expressed by an Item’s dashboard size.
_Avoid_: Time allocation, duration, project completion.

**Local allocation**: An Item’s intended share relative to its included siblings within its parent.

**Effort assessment**: A period-specific percentage of effort spent relative to current intent, calculated from children or assessed manually.
_Avoid_: Project progress, overall completion, time spent.

**Period**: The stretch represented by a dashboard from creation until closure through rollover.

**Rollover**: The explicit closing of the current dashboard and creation of a new period with its state carried forward.

**Snapshot**: A historical dashboard state retaining its checkpoint’s content and assessments independently of later current edits.

**Opening**: The snapshot of a newly created period’s unchanged inherited dashboard.

**Planned**: The optional snapshot captured when planning is marked finished.

**Closing**: The snapshot captured when a period ends through rollover.

**Widget**: Interactive content embedded within an Item’s notes area.

**Widget owner**: The Item whose notes contain a widget.

**Listing entry**: A file or folder offered by a live directory-listing widget, independently of any persistent Item referencing it.

**Create Item from listing**: The explicit action that creates a persistent Item referencing a selected listing entry.
_Avoid_: Video capture, file capture, import (for this action).

**Streamer group**: A user-defined visual grouping of Twitch streamers, assigned through a streamer-to-group mapping.
_Avoid_: Twitch category (which may mean the stream's game or content category).

**Streamer**: A followed Twitch channel in the live-channel widget.

**Feed entry**: An option supplied by a live feed that becomes an Item only through an explicit save action.

**Widget action**: A server-side action invoked from a widget, such as creating an Item, changing its status, or running a command.

## Relationships

- **Items** form a single-parent hierarchy; links in notes can reference Items elsewhere without adding parents.
- A **Dashboard** selects from that hierarchy; a **Period** retains its Opening, optional Planned, and Closing **Snapshots**.
- **Local allocation** determines shares within a parent; **Effort assessments** aggregate from children to parents, with manual overrides available.
- **Lifecycle status**, **Dashboard inclusion**, and **Effort assessment** are independently controlled concepts.
- A **Widget** may display **Feed entries** without creating child Items; widgets and local agents share callable application operations.
- **Create Item from listing** creates one child of the **Widget owner**; multiple Items may reference the same file or folder across completed viewing intentions.

## Example dialogue

> **Designer:** “Does reaching the intended effort for a Build project mean the Item is Done?”
> **Owner:** “No. The assessment is for this period; the project may not even have a meaningful completion target.”

## Terminology clarifications

- “Visible” means included on the dashboard for allocation and effort calculations; Show all can also draw excluded Items without changing that membership.
- “Effort” refers to an assessment relative to editable intent, not an absolute recorded quantity that is automatically rescaled when allocation changes.
- “Snapshot” specifies recoverable historical behaviour, without prescribing copies, commits, or another storage mechanism.
- “Server-side actions” is the intended widget capability; Server-Sent Events are not a specified transport requirement.
- “Create Item from listing” creates a reference-bearing Item for a local file or folder; it does not record video, copy media, or recursively import a directory.
- “Streamer” and “channel” refer to the same entity in the Twitch widget; a streamer group collects those entities.
