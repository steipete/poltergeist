# CLI Refactor Plan (2025-11-16)

Context: `src/cli.ts` was split into helper modules, but the entrypoint still mixes concerns and has hard exits that limit reuse/testing. This plan tracks the remaining cleanup steps.

## Goals
- Improve composability (no deep `process.exit` calls; return errors/results instead).
- Centralize parsing/formatting logic to avoid drift.
- Make detection/config scaffolding explicit and observable.
- Raise test coverage for CLI-side utilities without touching runtime behavior.

## Work Items
1. **Pure option parsing** ✅  
   - `parseGitSummaryModeOption` now throws; callers handle exits. Tests added.

2. **Log line parsing single source of truth** ✅  
   - `parseLogLine` powers tail/follow; tests cover JSON/plain/empty cases.

3. **Config detection controls** ✅  
   - `augmentConfigWithDetectedTargets` takes `allowAutoAdd` and returns summaries; `init` prints what was auto-added; tests cover makefile + skip.

4. **Error handling surface** ✅  
   - All CLI codepaths now route through `exitWithError`; remaining direct exits are limited to the helper itself.
   - Further integration tests still welcome to lock messaging, but exit surface is centralized.

5. **Version sourcing** ✅  
   - `cli/version.ts` now holds the constant imported by the entrypoint.

6. **Coverage gaps** ⏳  
   - Added tests for `parseLogLine`, `displayLogs` JSON/empty cases, and init auto-detection; still room to cover remaining wait/build messaging and lock-hint paths.

## Next Steps
- Implement items 1–3 in small PR-sized batches, keeping behavior stable and tests green.
- Re-run `./runner pnpm lint && ./runner pnpm typecheck && ./runner pnpm test` after each batch.
