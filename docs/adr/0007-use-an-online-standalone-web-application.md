# Use an online standalone web application

Life Manager will proceed as a standalone web application hosted locally, with full online browser functionality on mobile through a trusted network. Remote hosting is deferred; it imposes no current remote-runner or deployment requirements. This provides browser access while avoiding PWA, offline editing, and client-database synchronisation requirements.

SQLite is the working storage assumption. A general interchange format and parallel platform implementations are unnecessary at this stage; any later migration can be planned against the actual data model. The existing BB implementation remains available for reuse, while notes should preferably use an extensible Markdown-style representation.
