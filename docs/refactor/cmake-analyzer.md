# CMake Analyzer Refactor Plan

Purpose: capture actionable improvements for `src/utils/cmake-analyzer.ts` and related tooling.

## Proposed Steps
- **Decompose responsibilities**: Split into parser, build-query, and mapper modules with narrow interfaces; keep pattern helpers in `cmake-patterns.ts`.
- **Command runner safety**: Use injected async runner with timeouts, env allowlist, optional inherited stdio for debugging, and structured stderr on success.
- **Structured errors**: Return typed errors (`stage`, `message`, optional `stderr/stdout`) so the CLI can display actionable hints and choose retry policies.
- **Configurable side effects**: Make auto-configure (`cmake -B`) opt-in; add dry-run detection that never spawns processes.
- **Robust parsing**: Prefer a tiny `cmake -P` script to emit target metadata when build dir exists; fall back to regex parsing. Cache parsed CMakeLists content to reduce I/O.
- **Watch patterns**: Keep optimizer centralized; add debug flag to dump final patterns and prune noisy dirs (`build/`, `node_modules/`) unless whitelisted.
- **Tests**: Add fixture-based integration covering executable/shared/custom targets and verify generated Target configs + watch patterns. Keep existing pure helper unit tests.
- **Performance**: Parallelize CMakeLists glob reading; cap depth and file count to avoid scanning giant repos.
- **Docs**: Publish user-facing note (README section) describing what the analyzer executes and how to disable auto-configure.

## Quick Wins
- Enforce dependency injection for all I/O (fs + runner) to make tests hermetic.
- Emit a single consolidated result type (`CMakeAnalysis` + `errors: CMakeProbeError[]`).
- Add logging hooks so callers can surface progress without coupling to console.

## Open Questions
- Should we maintain compatibility with legacy tests expecting analyzer methods to exist? (Current alias export kept.)
- How strict should pruning be by default vs. config-driven?
