# Life Manager

- Read [PRD.md](PRD.md) as the canonical product specification and resume document.
- Use the vocabulary in [CONTEXT.md](CONTEXT.md) and consult [docs/adr/](docs/adr/) for decision rationale.
- The application is a standalone Node/SQLite web server with React and MDXEditor. Follow the current phase in the PRD; [README.md](README.md) owns run commands, storage and API details.
- The existing implementation's contracts live in `src/types.ts` and `ui/contracts.ts`. Keep shared-contract changes consistent across the UI, server and tests.
- Keep private workspace data, credentials, personal imports and local deployment instructions out of source control. Use synthetic examples in fixtures and documentation.
