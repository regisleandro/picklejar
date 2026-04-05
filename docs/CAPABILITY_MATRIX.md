# Picklejar — capability matrix by agent

**Current scope:** OpenAI Codex is **out of scope** for this roadmap. Integrations split into a **hooks track** (per-tool capture) and an **instructions / session track** (resume/context with less granularity).

| Agent | Track | Per-tool capture | Session start / resume | Instructions file | `picklejar start` | E2E automation |
|--------|--------|------------------|-------------------------|------------------------|-------------------|----------------|
| **Claude Code** | hooks | Yes (PostToolUse) | Yes (SessionStart + force-resume) | `CLAUDE.md` (resume injected) | `claude` | High |
| **Cursor** | hooks | Yes (`postToolUse`) | Yes (`sessionStart` + same core) | Optional: `.claude/` compatible | Launches IDE (see README) | Medium |
| **Continue CLI** | hooks | Yes (Claude-compatible) | Yes | Via hooks in `.continue/settings.json` | `continue` / per docs | Medium |
| **GitHub Copilot CLI** | hooks | Yes (`postToolUse` when available in your build) | Yes (`sessionStart`) | `.github/copilot-instructions.md` (recommended) | `copilot` (if on PATH) | Medium |
| **Cline** | hooks | Yes (`PostToolUse`) | Yes (`TaskStart` / `TaskResume` → core) | `.clinerules` + hooks | VS Code extension | Medium |
| **OpenCode** | instructions/session | Limited (no stable PostToolUse parity in core) | `resume` + `AGENTS.md` | `AGENTS.md` | `opencode` | Low–medium |
| **Kilo** | instructions/session | Same as OpenCode (CLI fork) | Same as OpenCode | `AGENTS.md` | `kilo` | Low–medium |
| **Antigravity** | instructions/skills | MVP: no stably documented tool hooks | Injection into `.agent/` | `.agent/picklejar-resume.md` | — (IDE) | Low |
| **Aider** | instructions/session | Via conventions / manual flow | `resume` + conventions file | `CONVENTIONS.md` (optional) | `aider` | Low |

## Notes

- **Hooks** reuse `.picklejar/hooks/run-hook.js` → scripts shipped with `picklejar-agent` (`src/hooks/*`).
- **Normalization:** `post-tool-use` accepts Claude-, Cursor-, and Cline-style payloads and generic JSON (`tool_output`, `result`, etc.).
- **Curation layer:** persisted action metadata can exclude hallucinations, dead ends, and inconsistent steps from `resume` / `export` without deleting the original audit trail.
- **Trusted handoff:** generated brain dumps now prioritize current trusted state, retained active files, and recent trusted actions; discarded paths can be added back explicitly for auditability.
- **Antigravity:** MVP integration centered on a versioned file under `.agent/`; extend when a stable hooks API exists.
