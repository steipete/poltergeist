# CLI Refactor Plan (2025-11-16)

Context: `src/cli.ts` was split into helper modules, but the entrypoint still mixes concerns and has hard exits that limit reuse/testing. This plan tracks the remaining cleanup steps.

## Goals
- Improve composability (no deep `process.exit` calls; return errors/results instead).
- Centralize parsing/formatting logic to avoid drift.
- Make detection/config scaffolding explicit and observable.
- Raise test coverage for CLI-side utilities without touching runtime behavior.

## Work Items
1. **Pure option parsing**  
   - Change `parseGitSummaryModeOption` to return `{ok, value}` or throw; let command handlers decide when to exit.  
   - Add tests for success/invalid paths with no global exit side effects.

2. **Log line parsing single source of truth**  
   - Extract `parseLogLine` (plain text + legacy JSON) in `cli/logging.ts`; reuse in both `readLogEntries` and `followLogs`.  
   - Add follow-mode tests covering JSON/plain mixed logs and target filtering.

3. **Config detection controls**  
   - Add an options bag to `augmentConfigWithDetectedTargets` to allow opting out of auto-added targets (Makefile/Go/Python) in scripted flows.  
   - Return a summary of what was added (type/name/reason) so `init` can print concise feedback and tests can assert behavior.

4. **Error handling surface**  
   - Replace scattered `process.exit(1)` in helpers with typed errors; top-level command actions should own exit decisions.  
   - Add minimal integration tests to ensure messages stay identical while exits move to the boundary.

5. **Version sourcing**  
   - Move the hardcoded `packageJson` shim into `cli/version.ts` and inject via build step to decouple CLI logic from compile-time stubs.

6. **Coverage gaps**  
   - Add focused tests for: `displayLogs` JSON output, `followLogs` tail-first behavior, init summary printing, and error-path messaging (build lock hints).

## Next Steps
- Implement items 1–3 in small PR-sized batches, keeping behavior stable and tests green.
- Re-run `./runner pnpm lint && ./runner pnpm typecheck && ./runner pnpm test` after each batch.
