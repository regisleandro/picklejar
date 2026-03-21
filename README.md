# picklejar-agent

Persist **Claude Code** sessions using **native hooks** (no HTTP proxy). Each tool call is saved incrementally to `.picklejar/snapshots/`; on resume, a **Brain Dump** (Markdown) can be injected as `additionalContext`.

## Requirements

- Node.js **20+**
- [Claude Code](https://www.anthropic.com) with project hooks support

## Install

```bash
npm install -g picklejar-agent
# or in your repo:
npm install --save-dev picklejar-agent
```

## Quick start

From your project root:

```bash
picklejar init
```

This creates:

- `.picklejar/` — config, `hooks/run-hook.js` (delegates to this package), `snapshots/`, `transcripts/`
- Appends Picklejar entries to `.claude/settings.json` (existing hooks are preserved)

Hook commands use `$CLAUDE_PROJECT_DIR/.picklejar/hooks/run-hook.js`, which runs the real scripts inside the installed package (so imports keep working).

## CLI

| Command | Description |
|--------|-------------|
| `picklejar init [dir]` | Set up `.picklejar` and register Claude hooks |
| `picklejar status [dir]` | Latest snapshot summary |
| `picklejar list [dir]` | List snapshot files |
| `picklejar inspect <id> [dir]` | Pretty-print session JSON |
| `picklejar export <id> [dir] [-o file.md]` | Write Brain Dump markdown |
| `picklejar resume [--id <id>] [dir]` | Write `force-resume.json` so next `SessionStart` injects the dump |
| `picklejar clean [--keep N] [dir]` | Prune old snapshots per session |

## Configuration

`.picklejar/config.json` (created on `init`):

- `maxTokens` — rough budget for Brain Dump size (default `30000`)
- `redactPatterns` — array of **regex sources** applied to `tool_response` before persistence (secrets scrubbing)

## How it works

1. **PostToolUse** — records each tool call, optional file snapshots, redaction + truncation, then saves a snapshot.
2. **Stop** — checkpoint + best-effort `lastPlannedAction` from the transcript tail.
3. **PreCompact** — safety snapshot + transcript copy under `.picklejar/transcripts/`.
4. **SessionEnd** — marks session `ended` and snapshots.
5. **SessionStart** (`matcher: resume`) — loads the latest snapshot (or the one from `picklejar resume`) and returns `{ additionalContext: "<markdown>" }`.

Snapshots are **msgpack** with a small header + **CRC32**; corrupted latest files fall back to the previous snapshot.

## Development

```bash
git clone <repo> && cd picklejar
npm install
npm test
node src/cli.js init /path/to/project
```

## License

MIT
