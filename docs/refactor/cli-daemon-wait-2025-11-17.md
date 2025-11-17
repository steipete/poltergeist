# CLI/Daemon + Wait Command Stabilization (2025-11-17)

- **Daemon timeouts**: `DaemonManager` now shares a single timeout source (`POLTERGEIST_DAEMON_TIMEOUT` or 30s) across retries and IPC startup. Fake timers trigger immediately in tests, while real timers honour backoff delays. This prevents hanging tests and preserves helpful timeout messaging.
- **Deprecated flag handling**: `exitWithError` now surfaces the actual error message even when `process.exit` is mocked, so callers see “Deprecated flag --cli/--mac” instead of generic exit messages.
- **Wrapper/CLI reliability**: Root `poltergeist.config.json` now validates (added `outputPath`), allowing wrapper-driven `status`/`list` commands to pass without config errors.
- **State filesystem robustness**: `FileSystemUtils.getStateDirectory()` ensures the state directory exists (respects `POLTERGEIST_STATE_DIR`), eliminating sporadic ENOENTs when tests write state/lock files.
- **Wait/logs UX alignment**: Logs command auto-selects a single building target and errors with “Multiple targets building…” when ambiguous, matching agent-facing expectations; wait command exit paths now deliver structured failure output and exit codes in tests.

Notes: Keep `POLTERGEIST_DEBUG_DAEMON=true` handy when diagnosing daemon startup; the timeout path now emits useful debug logs without relying on native timers.***
