# Poltergeist Refactor Follow-Ups (Nov 2025)

Observed while splitting `poltergeist.ts` into `BuildCoordinator` and `WatchService`.

## High-Value Improvements
- **Bounded subscription cleanup**: When targets are removed or reloaded, unsubscribe individual Watchman subscriptions; currently only torn down in full `stop()`.
- **Queue rebuild on config reload**: After build scheduling changes we recreate `IntelligentBuildQueue` but don’t re-register targets or refresh notifier bindings; add a rebind helper.
- **Constructor wiring**: Centralize dependency wiring (logger, watchman, notifier, queue) in one factory so `Poltergeist.start()` stays slim and tests share the same setup path.
- **Test coverage gaps**: Add unit tests for `WatchService` (grouping, exclusions, unsubscribe) and integration tests for config reload ensuring new coordinator/queue are used.
- **ANSI utility reuse**: Deduplicate ANSI stripping by importing `utils/ansi.ts` in CLI/tests instead of ad-hoc regexes.
- **Logging path helpers**: Extract a single helper returning resolved log path + channel to avoid duplication across CLI commands (panel `log-reader` still builds paths directly).
- **Ignore large artifacts**: Extend `.gitignore` for `apps/mac/.build/**`, `dist-bun/**`, and example `node_modules/typescript/lib/*` to keep commit helper clean.
- **Type tightening in mocks**: Replace `any` in state-manager and builder mocks with interfaces to keep new modules strictly typed.

## Suggested Execution Order
1) Ignore rules + ANSI reuse (low risk, reduces churn).
2) WatchService unsubscribe + tests.
3) Queue rebind on reload + tests.
4) Wiring factory cleanup.
5) Type tightening in mocks.
