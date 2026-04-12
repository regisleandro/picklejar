# Picklejar CLI Reference

This reference mirrors the current CLI surface implemented in `src/cli.js`.

## Commands

### `picklejar init [agent] [dir]`

Initializes `.picklejar/` and installs the selected agent integration.

Supported agent IDs:

- `claude`
- `cursor`
- `copilot`
- `cline`
- `continue`
- `opencode`
- `kilo`
- `antigravity`
- `aider`

Notes:

- omitting `agent` defaults to `claude`
- passing only a path keeps the legacy `picklejar init <dir>` behavior
- instructions-track agents still get shared runtime files, but rely on `resume` + `start`

### `picklejar capabilities [agent]`

Prints capabilities as JSON.

- without arguments: all agent capability entries
- with one `agent`: only that agent

### `picklejar status [dir]`

Prints the latest stored session id, snapshot file, action count, snapshot counter, goal, and ended state.

### `picklejar list [dir]`

Lists sessions from the latest snapshot per session.

Default columns:

- full session ID
- derived title
- status
- relative update time
- action count

Flags:

- `--verbose`: multi-line per-session detail with files, next action, and error
- `--json`: raw `listSessions()` JSON
- `--sections`: legacy per-snapshot view with detected content sections

Implementation notes:

- session IDs are not truncated
- the default title column is clipped at `80` characters

### `picklejar actions <id> [dir]`

Lists recorded actions for a session.

Output columns:

- 1-based action index
- timestamp
- tool name
- curation status
- include/exclude flag
- summary
- curation note

Flags:

- `--json`: raw action list JSON

### `picklejar inspect <id> [dir]`

Prints the stored session JSON.

### `picklejar export <id> [dir] [-o file]`

Writes the compiled brain dump to markdown.

If `--out` is omitted, the default path is:

- `.picklejar/export-<id>.md`

Shared filters:

- `--without-goal`
- `--without-next-action`
- `--without-error`
- `--without-progress`
- `--without-decisions`
- `--without-active-files`
- `--without-recent-actions`
- `--without-history`
- `--without-instructions`
- `--exclude-actions <indexes>`
- `--interactive-actions`
- `--ignore-curation`
- `--profile <balanced|strict|audit|recovery>`
- `--with-discarded-paths`
- `--list-actions`

### `picklejar resume [id] [dir]`

Prepares resume artifacts without launching an agent.

Files written:

- `.picklejar/resume-context.md`
- `.picklejar/force-resume.json`

Supports the same filter flags as `export`.

You can also pass:

- `--id <id>` to select a session without positional `id`

### `picklejar open <id> [dir] --agent <agent>`

Single-step handoff:

1. compile the brain dump for the selected session
2. write resume artifacts
3. inject the context into the target agent instruction file
4. launch the target agent when supported

Supports the same filter flags as `export`.

### `picklejar start [agent] [dir]`

Launches an agent using any already-prepared resume context.

This is the command to use after `picklejar resume`.

### `picklejar goal <text> [dir]`

Sets the goal on the latest session snapshot.

### `picklejar decide <description> <reasoning> [dir]`

Appends an architecture decision to the latest session snapshot.

### `picklejar clean [dir] --keep <n>`

Deletes older snapshot files per session and keeps the newest `n`.

Default:

- `--keep 50`

### `picklejar explore [dir]`

Starts the Explorer UI.

Flags:

- `--port <port>`: explicit port override
- `--remote`: bind to `0.0.0.0`, skip browser auto-open

Explorer capabilities:

- browse sessions
- read summaries
- inspect actions
- copy or export handoff markdown
- hand off directly to a target agent

## Brain Dump Sections

The compiled handoff markdown can contain:

- `USER ORIGINAL INTENT`
- `CURRENT TRUSTED STATE`
- `NEXT PLANNED ACTION`
- `ERROR / REASON FOR INTERRUPTION`
- `PROGRESS`
- `ARCHITECTURE DECISIONS`
- `ACTIVE FILES`
- `RECENT TRUSTED ACTIONS`
- `TRUSTED HISTORY`
- `DISCARDED PATHS`
- resume instruction footer

## Curation Metadata

Picklejar still understands persisted action curation metadata:

- `default`
- `confirmed`
- `discarded`
- `hallucinated`
- `inconsistent`
- `dead_end`

That metadata affects `export`, `resume`, `open`, and Explorer handoff filtering when present.

The current CLI exposes curation-aware filters and reporting, but not a top-level `curate` command.
