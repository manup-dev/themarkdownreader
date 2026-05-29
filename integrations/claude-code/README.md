# md-reader → Claude Code auto-open hook

When Claude Code **writes a new `.md`** (a plan, spec, research note…), surface it
automatically in an already-running md-reader. Opt-in, low-noise, dependency-free.

## Behaviour

- Fires only on the `Write` tool (new docs). Ongoing `Edit`s do **not** re-open.
- Silent no-op unless md-reader is reachable (default `http://localhost:5183`).
- Dedups the same file within 30s (configurable).
- Never blocks Claude (PostToolUse is non-blocking; the hook always exits 0).

## Install

1. Start md-reader (`npm run dev`, or `md-reader <file>`, or `./startup.sh`).
2. Add to your Claude Code settings (`~/.claude/settings.json` for all projects, or
   `.claude/settings.json` in one repo):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "node /ABSOLUTE/PATH/TO/md-reader/integrations/claude-code/open-in-reader.mjs"
          }
        ]
      }
    ]
  }
}
```

## Config (env vars)

- `MD_READER_URL` — where md-reader is served (default `http://localhost:5183`).
- `MD_READER_DEDUP_MS` — re-open suppression window in ms (default `30000`).
