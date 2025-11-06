# Agent-Oriented Workflows

Poltergeist was designed to work seamlessly with coding agents as well as humans. The daemon rebuilds in the background while your agent edits files, so binaries are ready by the time the agent wants to execute them.

## Why Agents Benefit

- **Zero manual rebuilds** – agents simply call `polter <target>` and never touch the build command directly.
- **Immediate feedback** – build errors propagate inline with actionable suggestions and captured logs.
- **Automatic retries** – recent failures trigger an auto-rebuild without requiring explicit instructions.
- **Real-time output** – `--verbose` streams logs so agents can surface build progress or pass it back to the user.
- **Token-aware defaults** – the CLI avoids noisy output unless requested, keeping LLM tokens in check.

## Command Experience for Agents

The CLI was built to match what an agent expects:

- `haunt` and `start` are interchangeable, and all commands have intuitive aliases.
- Non-TTY environments receive enhanced help output instead of terse errors.
- Fuzzy matching finds targets even when an agent misspells a name.
- Build times are tracked, letting agents set `wait` or timeout strategies intelligently.

## Recommended Agent Flow

1. Initialize the project once with `poltergeist init`.
2. Launch the daemon via `poltergeist haunt` (or `start`) and keep it running.
3. Use `polter <target>` for every execution; it waits for a fresh build automatically.
4. Inspect failures with `poltergeist logs` or `poltergeist status --verbose`.

For a deeper dive into configuration options, see the [CLI reference](./cli-reference.md) and [configuration guide](./configuration.md).
