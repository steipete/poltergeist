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

4. **Error handling surface**  
   - Replace scattered `process.exit(1)` in helpers with typed errors; top-level command actions should own exit decisions.  
   - Add minimal integration tests to ensure messages stay identical while exits move to the boundary.

5. **Version sourcing** ✅  
   - `cli/version.ts` now holds the constant imported by the entrypoint.

6. **Coverage gaps**  
   - Add focused tests for: `displayLogs` JSON output, `followLogs` tail-first behavior, init summary printing, and error-path messaging (build lock hints).

## Next Steps
- Implement items 1–3 in small PR-sized batches, keeping behavior stable and tests green.
- Re-run `./runner pnpm lint && ./runner pnpm typecheck && ./runner pnpm test` after each batch.
