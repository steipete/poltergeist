# CLI and configuration guide

This guide expands on the [README quick start](../README.md#quick-start). Poltergeist uses `poltergeist` to configure and control builds and `polter` to run executable targets only after their artifacts are fresh.

## Project setup

Start in the project root:

```sh
poltergeist init --auto
poltergeist list
```

Automatic setup recognizes Swift, Node.js, Rust, Python, CMake, Make, and Go projects. It writes `poltergeist.config.json`; inspect the generated build commands and output paths before starting the daemon.

For CMake, the initializer can inspect an existing build tree or configure one:

```sh
poltergeist init --cmake
poltergeist init --cmake --cmake-no-configure
```

The second form detects targets without running `cmake -B`. Use `--preset`, `--generator`, or `--build-dir` when the project needs an explicit CMake setup.

## Minimal configuration

An executable target identifies its build command, output, and watched files:

```json
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "app",
      "type": "executable",
      "buildCommand": "pnpm run build",
      "outputPath": "dist/app.js",
      "watchPaths": ["src/**/*.ts", "package.json"]
    }
  ]
}
```

Supported target types are `executable`, `app-bundle`, `library`, `framework`, `test`, `docker`, `custom`, `npm`, `cmake-executable`, `cmake-library`, and `cmake-custom`. The files in [`examples/`](../examples/) show complete configurations for common project layouts.

Changes to `poltergeist.config.json` reload while the daemon is running. Target settings include environment variables, retry behavior, notification icons, post-build commands, log channels, and per-target settling or debounce intervals.

## Daemon and build commands

| Command | Purpose |
| --- | --- |
| `poltergeist haunt` | Start the project daemon in the background |
| `poltergeist haunt --foreground` | Run the daemon in the current terminal |
| `poltergeist stop` | Stop the project daemon |
| `poltergeist restart` | Restart the project daemon |
| `poltergeist list` | List configured targets |
| `poltergeist build [target]` | Run a target build immediately |
| `poltergeist clean --dry-run` | Preview removal of stale state files |

`start` is an alias for `haunt`, and `rest` is an alias for `stop`. When several targets are enabled, pass `--target <name>` where supported or name the target directly for `build`.

## Fresh execution with `polter`

Run an executable target through `polter` instead of invoking its output directly:

```sh
polter app -- --help
```

`polter` checks the daemon state, waits for an in-progress build, reports failed builds, and then executes the configured `outputPath` with the remaining arguments. Use `--` before target flags that overlap with Polter's own options. Useful Polter controls include `--timeout`, `--no-wait`, `--no-logs`, and `--force`; run `polter --help` for the complete list.

For coding-agent workflows, use `polter <target>` as the execution boundary. The build stays with the daemon, while the caller gets either a fresh artifact or a clear build failure.

## Logs, status, and automation

```sh
poltergeist status --verbose
poltergeist logs app --follow
poltergeist wait app
poltergeist build app --json
```

`status`, `wait`, `build`, and `clean` provide JSON modes where supported. Scripts can wait for a named target, inspect the result, or follow a target's build and test log channels without parsing the interactive panel.

Use `poltergeist panel` for the interactive dashboard. Its git summaries, status and summary scripts, log channels, and keyboard controls are documented in the [panel guide](panel.md). Live progress formats are described in [progress reporting](progress.md).

Automatic builds can be suspended without stopping the daemon:

```sh
poltergeist pause
poltergeist build app
poltergeist resume
```

Manual builds still run while automatic builds are paused. See [pause and resume controls](pause-resume.md) for behavior and state details.

## Hot reload

`polter` can keep an executable running and restart it after a successful build:

```sh
polter app --watch
```

Use `--restart-signal` and `--restart-delay` when the process needs a particular shutdown sequence. The same behavior can be owned by the daemon through an executable target's `autoRun` configuration:

```json
{
  "name": "server",
  "type": "executable",
  "buildCommand": "pnpm run build",
  "outputPath": "dist/server.js",
  "watchPaths": ["src/**/*.ts"],
  "autoRun": {
    "enabled": true,
    "restartSignal": "SIGTERM",
    "restartDelayMs": 250
  }
}
```

For app bundles, backend frameworks, simulators, or devices, keep the daemon responsible for building and put relaunch or deployment work in the target's build or post-build commands. Per-target `settlingDelay` and `debounceInterval` values can reduce duplicate work after large file changes.

## Troubleshooting

- Run `watchman --version` if the daemon cannot start watching.
- Run `poltergeist status --verbose` for daemon, target, and last-build details.
- Run `poltergeist logs <target> --follow` while reproducing a failed build.
- Run `poltergeist clean --dry-run` before removing stale state.
- Set `POLTERGEIST_LOG_LEVEL=debug` or pass `--verbose` when diagnosing daemon startup.

The interactive panel needs a real TTY; its input-debugging workflow is in [iTerm panel debugging](iterm-debugging.md).
