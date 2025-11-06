# CLI Reference

Poltergeist provides two primary commands:

- `poltergeist` controls the background daemon (start/stop/status/logs/config).
- `polter` executes fresh binaries once the latest build has succeeded.

## Core `poltergeist` Commands

```bash
# Start watching (daemon mode)
poltergeist haunt
poltergeist start

# Inspect projects
poltergeist status          # All targets
poltergeist status --target my-app
poltergeist logs -f         # Follow target logs

# Manage the daemon
poltergeist stop
poltergeist stop --target backend
poltergeist restart --foreground

# Project setup & maintenance
poltergeist init --auto
poltergeist init --cmake
poltergeist list
poltergeist clean --dry-run
```

### Daemon Mode Details

Poltergeist runs as a daemon by default so your terminal is freed immediately:

- Background process per project
- Logs persist across sessions (`poltergeist logs`)
- Commands operate across all active projects

To force foreground mode:

```bash
poltergeist haunt --foreground
```

## Smart Execution with `polter`

`polter` guarantees you never run stale builds:

```bash
polter <target> [args...]          # Wait for success then execute
polter my-app --timeout 60000      # Custom wait timeout (ms)
polter my-app --force              # Ignore last failure
polter my-app --verbose            # Stream build output
```

Execution flow:

1. Checks the latest build status for the target.
2. Waits for in-flight builds, showing progress when requested.
3. Fails fast if the build failed, surfacing the recorded error.
4. Executes the freshly rebuilt binary with your original arguments.

## Helpful Tips

- Use `poltergeist status --verbose` to inspect build durations and queue state.
- `poltergeist logs <target>` shows tail output; add `-f` to follow.
- `POLTERGEIST_TEST_MODE=true` short-circuits daemon startup for CI and unit tests.
- Combine `polter` with shell scripts (e.g., `polter api-server -- --port 8080`) for consistent environments.
