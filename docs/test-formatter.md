# Test output formatter (Swift & TS)

Poltergeist can auto-compact noisy test output into a single summary line in the panel.

## How it works
- For status scripts, Poltergeist checks the `formatter` field (default: `auto`).
- `auto` detects common test runners:
  - Swift: commands containing `swift test`
  - TS/JS: commands containing `vitest`, `jest`, `npm test`, or `pnpm test`
- When detected, panel output is reduced to one line (e.g. `PASS · 18 tests · 0 fail · 12.3s`). Failures include the first failing test name when available.
- Raw logs remain in the target’s log view; only the summary is shown in the main list.

## Config
You can set `formatter` on any `statusScripts` entry:
```json
"statusScripts": [
  {
    "label": "Tests (Commander)",
    "command": "swift test --package-path Commander",
    "formatter": "auto",          // default
    "maxLines": 3,                // still respected for unformatted output
    "cooldownSeconds": 600
  }
]
```

Accepted values:
- `"auto"` (default): best-effort detection and summarization.
- `"swift"`: force Swift formatter.
- `"ts"`: force Vitest/Jest formatter.
- `"none"`: disable formatting; show raw lines.

## Notes
- Formatting is applied to status script output only (build and post-build logs are untouched).
- If the formatter cannot parse the output, Poltergeist falls back to the original lines.
