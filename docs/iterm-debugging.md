# iTerm Panel Debugging

## Why scripted terminals matter
Testing the `pi-tui` panel inside this repo requires a **real** terminal (iTerm, tmux, etc.). The panel won't launch in the sandbox shell (`pnpm exec tsx src/cli.ts panel` exits immediately because stdio isn’t a TTY). Always exercise keyboard/mouse input via an external terminal. We use [mcporter](../mcporter) plus the [`iterm-mcp`](https://github.com/ferrislucas/iterm-mcp) server to drive iTerm programmatically.

## Launching the panel through mcporter
```bash
cd ~/Projects/mcporter
# Start the panel inside iTerm’s active tab
./runner pnpm run mcporter call \
  'iterm.write_to_terminal(command: "cd ~/Projects/poltergeist && pnpm exec tsx src/cli.ts panel")'

# Read the terminal buffer to confirm it’s running
./runner pnpm run mcporter call 'iterm.read_terminal_output(linesOfOutput: 40)'
```

## Sending keys (quit, refresh, etc.)
```bash
# Quit via “q”
./runner pnpm run mcporter call 'iterm.write_to_terminal(command: "q")'

# Trigger a refresh
./runner pnpm run mcporter call 'iterm.write_to_terminal(command: "r")'

# Inspect the buffer after key presses
./runner pnpm run mcporter call 'iterm.read_terminal_output(linesOfOutput: 20)'
```

> **Note:** `iterm.write_to_terminal` executes shell *commands* (it effectively types `q⏎`). Raw-mode apps won’t see those as keystrokes—they just echo in the shell. To send actual keys (without Enter), use tmux `send-keys`, iTerm hotkey windows, or extend `iterm-mcp` with a dedicated `send_keys` tool.

Set `POLTERGEIST_INPUT_DEBUG=1` to log raw input bytes while diagnosing keyboard issues:
```bash
./runner pnpm run mcporter call \
  'iterm.write_to_terminal(command: "cd ~/Projects/poltergeist && POLTERGEIST_INPUT_DEBUG=1 pnpm exec tsx src/cli.ts panel")'
```

## When the terminal gets stuck
- **Kill iTerm2** and reopen it if the panel stops responding. Quick options:
  - `osascript -e 'tell application "iTerm2" to quit'`
  - `killall iTerm2`
- Relaunch mcporter commands afterwards to reattach the panel session.

## Key takeaways
- You cannot reproduce the panel’s keyboard/mouse behavior inside the repo’s non-interactive shell—use iTerm (or another real terminal) driven via mcporter.
- mcporter’s `iterm.*` tools (`write_to_terminal`, `read_terminal_output`, `send_control_character`) provide a reproducible way to script iTerm for CI/debugging.

## Input Debugging
- Export `POLTERGEIST_INPUT_DEBUG=1` before launching the panel to capture raw input bytes.
  ```bash
  POLTERGEIST_INPUT_DEBUG=1 pnpm exec tsx src/cli.ts panel
  # or via mcporter/iterm-mcp
  ./runner pnpm run mcporter call 'iterm.write_to_terminal(command: "cd ~/Projects/poltergeist && POLTERGEIST_INPUT_DEBUG=1 pnpm exec tsx src/cli.ts panel")'
  ```
- Raw input events are appended to `/tmp/poltergeist-panel-input.log` as hex + decoded text:
  ```
  tail -n20 /tmp/poltergeist-panel-input.log
  # [PanelInputDebug] 2025-11-15T14:31:42.123Z bytes=71 text="q"
  ```
- Use this log to map iTerm/tmux escape sequences; bind them explicitly if needed.
- If the log stops updating while iTerm shows the panel, the MCP bridge may be hung—kill/restart iTerm and relaunch via mcporter.
- A scripted flow that reliably works today:
  1. ```bash
     ./runner pnpm run mcporter call \
       'iterm.send_keys(text: "cd ~/Projects/poltergeist && ./scripts/run-panel-once.sh\r")'
     ```
     2. ```bash
        ./runner pnpm run mcporter call 'iterm.send_keys(text: "q")'
     ```
- 3. `tail -n20 /tmp/panel.log` confirms you saw `[panel] starting/closed`, and `tail -n20 /tmp/poltergeist-panel-input.log` shows `bytes=71` + `exit via q`. If the log doesn’t update, the keystroke never reached the panel—relaunch iTerm and retry.
