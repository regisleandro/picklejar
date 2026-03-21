# picklejar-agent

Persist AI agent sessions using **native hooks** (no HTTP proxy). Each tool call is saved incrementally to `.picklejar/snapshots/`; on resume, a **Brain Dump** (Markdown) is injected into the agent's context via an agent-specific adapter.

Currently supports **Claude Code**. Designed to accommodate other agents (Cursor, Aider, Gemini CLI, etc.) via the adapter layer in `src/adapters/`.

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

## Resuming a session

```bash
# 1. Prepare the resume (compiles brain dump, writes resume-context.md)
picklejar resume [id]

# 2. Start the agent with context injected
picklejar start claude
```

`picklejar start claude` writes the brain dump into `CLAUDE.md` (wrapped in markers), spawns `claude`, and the `SessionStart` hook cleans up the injected section once the session is underway.

> **Why two steps?** `additionalContext` from Claude Code's `SessionStart` hook is not injected for new (`startup`) sessions — only for `resume` and `compact` sources. Writing to `CLAUDE.md` before the agent starts is the reliable path for new sessions.

## CLI

| Command | Description |
|--------|-------------|
| `picklejar init [dir]` | Set up `.picklejar` and register Claude hooks |
| `picklejar status [dir]` | Latest snapshot summary |
| `picklejar list [dir]` | List snapshot files |
| `picklejar inspect <id> [dir]` | Pretty-print session JSON |
| `picklejar export <id> [dir] [-o file.md]` | Write Brain Dump markdown |
| `picklejar resume [id] [dir]` | Compile brain dump and write `resume-context.md` + `force-resume.json` |
| `picklejar start [agent] [dir]` | Inject context and start the agent (`claude` supported) |
| `picklejar goal <text> [dir]` | Set the goal on the latest session snapshot |
| `picklejar decide <description> <reasoning> [dir]` | Record an architecture decision |
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
5. **SessionStart** (`matcher: startup`) — saves a snapshot for new sessions; if `force-resume.json` exists, cleans up the `CLAUDE.md` resume section.
6. **SessionStart** (`matcher: resume|compact`) — loads the target snapshot and returns `{ additionalContext: "<markdown>" }` for context injection.

Snapshots are **msgpack** with a small header + **CRC32**; corrupted latest files fall back to the previous snapshot.

## Adapter architecture

Agent-specific context injection lives in `src/adapters/`:

- `claude-code.js` — writes/cleans the `<!-- PICKLEJAR RESUME START/END -->` section in `CLAUDE.md`

To add support for another agent, create `src/adapters/<agent>.js` and wire it into the `start` command.

## Development

```bash
git clone <repo> && cd picklejar
npm install
npm test
node src/cli.js init /path/to/project
```

## License

MIT
