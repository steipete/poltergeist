# Poltergeist Panel Guide

This doc covers how the `polter panel` TUI is populated, how summaries (AI/Git/custom) are selected and rendered, and how to wire project-specific scripts into the view.

## Anatomy
- **Header**: project name, branch/upstream status, counts for building/failed/running daemons.
- **Targets table**: one row per target plus optional Summary/row entries; `statusScripts` render indented under their target.
- **Summary area**: shows AI summary, Git dirty list, or any custom summary script when the Summary row (or custom row) is selected.
- **Logs**: tail of the selected target’s log channel(s); auto-refreshes every second while a build is active.
- **Footer**: keybindings (`↑/↓`, `←/→`, `r`, `q`).

## Keybindings
- `↑/↓` move selection (targets → Summary row → custom summary rows).
- `←/→` when on Summary cycles summary modes (AI, Git, custom). On targets, cycles log channels (or toggles all/tests when only one channel).
- `r` forces an immediate refresh of targets, Git, status scripts, and summary scripts.
- `q` / `Ctrl+C` exits.

## Configuration (poltergeist.config.json)

### statusScripts (unchanged)
- Run on their own cooldown; results render under each target or in the global block.
- Fields: `label`, `command`, optional `targets`, `cooldownSeconds`, `timeoutSeconds`, `maxLines`, `formatter`.

### summaryScripts (new)
Custom summaries shown alongside AI/Git.

Fields:
- `label` (string): displayed title.
- `command` (string): executed in project root. Output lines become the summary body (10-line default cap).
- `placement` (`"summary" | "row"`, default `"summary"`):
  - `summary`: adds a tab in the Summary row (cycle with ←/→).
  - `row`: adds its own row directly below Summary; select it with `↓` to view.
- `refreshSeconds` (number, default 1800): minimum seconds between reruns; cached output is reused until interval elapses.
- `timeoutSeconds` (default 30): process timeout.
- `maxLines` (default 10, max 50): render cap.
- `formatter` (`auto|none|swift|ts`, default `auto`): same formatter used for status scripts.

Behavior:
- Cached results emit immediately on panel start; reruns happen in the background respecting `refreshSeconds`.
- Non-zero exit codes are shown but still rendered; use exit codes to flag “needs attention”.
- Scripts execute with `FORCE_COLOR=0` and 1 MB stdout/stderr buffer.

### Example: dependency dry-run every 30 minutes
```jsonc
{
  "summaryScripts": [
    {
      "label": "Dependencies",
      "placement": "summary",
      "command": "node -e \"const {execSync}=require('node:child_process');function emit(data){if(!Array.isArray(data)||data.length===0){process.exit(0);}for(const row of data){console.log(row.name + '@' + row.path + ' ' + row.current + ' -> ' + row.latest);}process.exit(1);}try{const out=execSync('pnpm outdated --recursive --long --format=json',{encoding:'utf8'}).trim();if(!out){process.exit(0);}emit(JSON.parse(out));}catch(err){const out=err.stdout?.toString().trim();if(!out){console.error(err.message||String(err));process.exit(1);}emit(JSON.parse(out));}\"",
      "refreshSeconds": 1800,
      "timeoutSeconds": 120,
      "maxLines": 10
    }
  ]
}
```

## Rendering rules
- Summary row order: targets → Summary row (if any summary sources) → custom rows (`placement: "row"`).
- Summary mode priority when opening: first available among AI, Git, then custom summaries in config order.
- Custom row selection shows its body in the summary pane; tabbed customs share cycling with AI/Git.
- Log pane hides when a summary/custom row is selected; reappears when a target row is selected.

## Operational tips
- Keep `refreshSeconds` ≥30 to avoid tight polling; 30–300s is good for fast diagnostics, 1800s for slow checks like dependency drift.
- Keep `maxLines` low (≲20) for readability; scripts should format succinct, one item per line.
- Use non-zero exit codes to surface “needs attention” badges in the table for row placements.
- For long-running checks, raise `timeoutSeconds` rather than stretching `refreshSeconds` if you need frequent updates.

## Troubleshooting
- If a summary script never shows output: ensure the command prints something to stdout; empty output is treated as “clean” and hidden.
- If the panel flickers between modes: verify your `placement` choices—use `row` for always-visible entries, `summary` for tabbed.
- To debug input, set `POLTERGEIST_INPUT_DEBUG=1` and press keys; bytes log to `/tmp/poltergeist-panel-input.log`.
