# Contributing

Each new or modified plugin is self-contained under `extensions/<plugin>/` and follows the same local verification contract.

## Test contract

- Put deterministic unit tests in `extensions/**/*.test.ts`.
- Keep unit tests offline: no API keys, network calls, paid model requests, or user-home state.
- Add a smoke test in `scripts/smoke/<plugin>.test.mjs` for package discovery and the plugin's most important routing or registration behavior.
- Keep smoke tests offline and fast. Use a separate opt-in command for real-provider integration checks; never include those checks in the default commands.
- Import Pi runtime APIs from documented package roots only. Runtime imports from Pi `api/`, `dist/`, or `src/` subpaths are not Extension Loader contracts.
- For entrypoints that use Pi peer dependencies, add a source-boundary smoke check and verify the complete entrypoint with `npm run verify:stock-pi` before handoff.

Run both commands before handing off a plugin change:

```bash
npm test
npm run smoke
npm run verify:stock-pi  # installed stock Pi; loads every extension entrypoint without provider calls
```

The scripts discover all matching files, so adding a plugin test or smoke test does not require changing `package.json`.
