# CLI Refactor To-Do

Status: in-progress (2025-11-16)
Owner: steipete / agents
Scope: poltergeist CLI (src/cli.ts and children)

## Quick Wins
- ✅ Replace dynamic `await import(...)` with typed helper loaders per module (DaemonManager, builders, polter) to keep type-safety and Bun compile inclusion predictable.
- ✅ Extract shared log file resolver used by `logs` and `status` commands; return structured info (found path, channel, fallback used) to avoid drift and simplify tests.
- ✅ Add `--json` output to `wait` for automation; include target, status, duration, and last error when present.
- ✅ Create `resultOrExit` helper (`ensureOrExit`) to centralize exit behavior in CLI commands.
- ⏳ Reuse single `WatchmanConfigManager`/logger in `init` path instead of constructing per branch; minor perf and log consistency improvement.

## Tests & DX
- Add smoke test for `status panel` in test mode with git summary stubs to protect module boundaries and static imports.
- Improve `daemon-no-targets` test latency further (now under 5s); consider polling for state creation instead of fixed waits.
- Add registration snapshot test that verifies command/alias/options match help formatter groups to prevent help drift.

- 🔸 Move command registration to declarative descriptors (name, description, options, handler factory) consumed by both Commander wiring and help formatter.
- ✅ Introduce shared option schemas for common flags (config, target, log-level) to keep descriptions/aliases aligned and auto-generate help.
- ✅ Streamline `clean` command: instantiate `StateManager` once, add `--json` summary.
- 🔸 Consider lazy-loading heavy deps behind static import fences (e.g., panel, builders) using top-level `import` with narrow modules to stay Bun-compile safe while trimming startup cost.

## Safeguards
- Maintain static imports for anything needed in Bun binary; if adding lazy paths, ensure they’re tree-shaken into compile via explicit static side imports.
- Keep new docs/tests up to date with AGENTS.md guardrails and CHANGELOG style rules.
