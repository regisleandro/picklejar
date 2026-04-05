# picklejar-agent

Persist AI agent sessions using **native hooks**. Each tool use can be saved incrementally to `.picklejar/snapshots/`; on resume, a **Brain Dump** (Markdown) is injected via agent-specific adapters.

**Supported agents (see [docs/CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md)):** Claude Code, Cursor, Continue CLI, GitHub Copilot CLI, Cline (hooks track); OpenCode, Kilo, Antigravity, Aider (instructions / session track). **OpenAI Codex is out of scope** for this roadmap.

## Requirements

- Node.js **20+**
- The agent you use (Claude Code, Cursor, `cn`, Copilot CLI, etc.)

## Install

```bash
npm install -g picklejar-agent
# or in your repo:
npm install --save-dev picklejar-agent
```

## Quick start

```bash
# Default: Claude Code (.claude/settings.json)
picklejar init

# Or pick an agent
picklejar init cursor
picklejar init copilot
picklejar init cline
picklejar init continue

# Legacy: init only a path (same as: picklejar init claude <path>)
picklejar init /path/to/project
```

This creates `.picklejar/` (config, `hooks/run-hook.js`, snapshots, transcripts) and registers hooks for the chosen integration.

## Capabilities overview

```bash
picklejar capabilities
picklejar capabilities cursor
```

## Resuming a session

```bash
picklejar resume [sessionId]
picklejar start claude    # or: cursor, cn, opencode, kilo, aider, …
```

- **Hooks-track agents** (Claude, Cursor, Continue, Copilot CLI, Cline): hooks call `run-hook.js`, which runs the packaged scripts under `src/hooks/`.
- **Instructions-track** (OpenCode, Kilo, Antigravity, Aider): `picklejar start` injects the brain dump into `AGENTS.md`, `CONVENTIONS.md`, or `.agent/picklejar-resume.md` as appropriate, in addition to `CLAUDE.md` when useful for compatibility.

> **Claude Code nuance:** `additionalContext` on `SessionStart` is not applied for brand-new `startup` sessions; writing to `CLAUDE.md` before `picklejar start claude` remains the reliable path. Other products differ — see the matrix doc.

## CLI

| Command | Description |
|--------|-------------|
| `picklejar init [agent] [dir]` | Set up `.picklejar` + hooks for `agent` (default `claude`) |
| `picklejar capabilities [agent]` | JSON summary of integration track / notes |
| `picklejar status [dir]` | Latest snapshot summary |
| `picklejar list [dir] [--verbose] [--sections]` | List snapshot files, optionally with derived session details |
| `picklejar inspect <id> [dir]` | Pretty-print session JSON |
| `picklejar export <id> [dir] [-o file.md] [filters...]` | Write brain dump markdown |
| `picklejar resume [id] [dir] [filters...]` | Write `resume-context.md` + `force-resume.json` |
| `picklejar start [agent] [dir]` | Inject resume context and launch the agent CLI when available |
| `picklejar goal <text> [dir]` | Set goal on latest session |
| `picklejar decide <desc> <reason> [dir]` | Record architecture decision |
| `picklejar clean [--keep N] [dir]` | Prune old snapshots per session |

Examples:

```bash
picklejar list
picklejar list --verbose
picklejar list --verbose --sections
```

- `--verbose` switches to a compact summary view with timestamp, derived title, action count, and ended status, without the snapshot file path column.
- `--sections` adds a compact list of detected content areas present in the snapshot, such as `goal`, `progress`, `active files`, and `recent actions`.

## Configuration

`.picklejar/config.json`:

- `maxTokens` — brain dump budget (default `30000`)
- `redactPatterns` — regex sources applied to tool output before persistence

## Filtering export and resume output

`picklejar export` and `picklejar resume` can exclude sections from the generated brain dump without changing the stored snapshot.

Examples:

```bash
picklejar export session-123 --without-active-files --without-history
picklejar resume session-123 --without-recent-actions --without-instructions
picklejar export session-123 --exclude-actions 1,3,8
picklejar resume session-123 --interactive-actions
picklejar export session-123 --list-actions
```

Available section filters:

- `--without-goal`
- `--without-next-action`
- `--without-error`
- `--without-progress`
- `--without-decisions`
- `--without-active-files`
- `--without-recent-actions`
- `--without-history`
- `--without-instructions`

Action filtering details:

- `--list-actions` prints all recorded actions with stable 1-based indexes.
- `--exclude-actions 2,4,9` removes specific actions from `RECENT ACTIONS` and `SUMMARIZED HISTORY` in the generated summary.
- `--interactive-actions` opens a keyboard selector in TTY terminals (`up/down`, `space`, `a`, `n`, `enter`, `q`) and falls back to the prompt-based index input outside TTY.
- Filtering only affects the generated markdown; the underlying snapshot remains unchanged.

## How it works (core)

1. **PostToolUse** (and equivalents) — normalize payloads from Claude, Cursor, Cline, etc., then record actions and snapshot.
2. **Stop** — checkpoint + `lastPlannedAction` from transcript when possible.
3. **PreCompact** — safety snapshot + transcript backup under `.picklejar/transcripts/`.
4. **SessionEnd** — marks session ended.
5. **SessionStart** / **TaskStart** / **TaskResume** — resume injection + cleanup of injected markdown when `force-resume.json` is present.

Snapshots use **msgpack** + **CRC32** with fallback to the previous file if the latest is corrupt.

## Development

```bash
git clone <repo> && cd picklejar
npm install
npm test
node src/cli.js init cursor /path/to/project
```

## License

MIT
