# Picklejar Capability Matrix

This matrix reflects the current integrations implemented in `src/agents/` and `src/core/agent-templates.js`.

Integrations are split into:

- hooks track: Picklejar captures tool/session events directly through agent hooks
- instructions track: Picklejar prepares resume context and injects it into an instruction file, but does not rely on per-tool hooks

## Matrix

| Agent | Track | Per-tool capture | Session start / resume | Resume injection target | `picklejar start` behavior | Notes |
|--------|-------|------------------|-------------------------|-------------------------|----------------------------|-------|
| `claude` | hooks | Yes | Yes | `CLAUDE.md` | launches `claude` | Uses Claude-style `SessionStart` hooks |
| `cursor` | hooks | Yes | Yes | `CLAUDE.md` and `AGENTS.md` | launches `cursor <projectDir>` | Uses `.cursor/hooks.json` |
| `continue` | hooks | Yes | Yes | `CLAUDE.md` and `AGENTS.md` | launches `cn` | Uses Claude-compatible `.continue/settings.json` |
| `copilot` | hooks | Partial / build-dependent | Yes | `AGENTS.md` | launches `copilot` | Installs `.github/hooks/picklejar-agent.json` plus scripts |
| `cline` | hooks | Yes | Yes | `CLAUDE.md` and `AGENTS.md` | prints IDE guidance | Installs `.clinerules/hooks/*` |
| `opencode` | instructions | No | Via `resume` / `open` | `AGENTS.md` | launches `opencode` | No hook parity in core |
| `kilo` | instructions | No | Via `resume` / `open` | `AGENTS.md` | launches `kilo` | OpenCode-compatible workflow |
| `antigravity` | instructions | No | Via `resume` / `open` | `.agent/picklejar-resume.md` | prints IDE guidance | IDE-based flow |
| `aider` | instructions | No | Via `resume` / `open` | `CONVENTIONS.md` | launches `aider` | Optional conventions-file workflow |

## Shared Runtime

All integrations use the same project-local runtime under `.picklejar/`:

- `config.json`
- `hooks/run-hook.js`
- `snapshots/`
- `transcripts/`
- `resume-context.md`
- `force-resume.json`

## Hook Coverage

Where the host agent supports it, Picklejar handles these lifecycle points:

- post-tool-use
- session-start / task-start / task-resume
- pre-compact
- stop
- session-end

## Notes

- payload normalization accepts Claude-, Cursor-, Cline-, and generic JSON-shaped tool events
- exported and resumed brain dumps are curation-aware when action metadata is present
- Explorer handoff uses the same resume-service path as `picklejar open`
- local Explorer sessions use an ephemeral token; remote Explorer mode prints the token explicitly
- OpenAI Codex is not part of the current integration scope
