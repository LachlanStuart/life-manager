# Use BB storage and shared plugin actions

Superseded for the deployment direction by [ADR 0007](0007-use-an-online-standalone-web-application.md). This record describes the existing BB implementation; its shared-operation approach remains useful for reuse.

Life Manager runs as a BB plugin with a native navigation page and BB-owned SQLite storage. Current Items are independently stored rows with sibling-relative weights; period snapshots retain complete Item records so historical notes and hierarchy can be recovered and corrected without changing current data. The UI, widget handlers, and local-agent CLI share the same validated operations, avoiding separate behavioural implementations for each entry point.
