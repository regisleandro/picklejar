# Picklejar — matriz de capacidades por agente

Escopo atual: **sem OpenAI Codex** nesta rodada. Integrações variam entre **trilha hooks** (captura por tool) e **trilha instruções/sessão** (resume/contexto com menos granularidade).

| Agente | Trilha | Captura por tool | Session start / resume | Arquivo de instruções | `picklejar start` | Automação e2e |
|--------|--------|------------------|-------------------------|------------------------|-------------------|---------------|
| **Claude Code** | hooks | Sim (PostToolUse) | Sim (SessionStart + force-resume) | `CLAUDE.md` (resume injetado) | `claude` | Alta |
| **Cursor** | hooks | Sim (`postToolUse`) | Sim (`sessionStart` + mesmo núcleo) | Opcional: compatível com `.claude/` | Abre IDE (documentado no README) | Média |
| **Continue CLI** | hooks | Sim (Claude-compatible) | Sim | Via hooks em `.continue/settings.json` | `continue` / documentação | Média |
| **GitHub Copilot CLI** | hooks | Sim (`postToolUse` quando disponível na sua versão) | Sim (`sessionStart`) | `.github/copilot-instructions.md` (recomendado) | `copilot` (se no PATH) | Média |
| **Cline** | hooks | Sim (`PostToolUse`) | Sim (`TaskStart` / `TaskResume` → núcleo) | `.clinerules` + hooks | Extensão VS Code | Média |
| **OpenCode** | instruções/sessão | Limitada (sem paridade PostToolUse estável no núcleo) | `resume` + `AGENTS.md` | `AGENTS.md` | `opencode` | Baixa–média |
| **Kilo** | instruções/sessão | Idem OpenCode (CLI fork) | Idem | `AGENTS.md` | `kilo` | Baixa–média |
| **Antigravity** | instruções/skills | MVP: sem hooks de tool documentados de forma estável | Injeção em `.agent/` | `.agent/picklejar-resume.md` | — (IDE) | Baixa |
| **Aider** | instruções/sessão | Via convenções / fluxo manual | `resume` + arquivo de convenções | `CONVENTIONS.md` (opcional) | `aider` | Baixa |

## Notas

- **Hooks** reutilizam ` .picklejar/hooks/run-hook.js` → scripts em `picklejar-agent` (`src/hooks/*`).
- **Normalização**: `post-tool-use` aceita payloads estilo Claude, Cursor, Cline e JSON genérico (`tool_output`, `result`, etc.).
- **Antigravity**: integração MVP focada em arquivo versionado em `.agent/`; evoluir quando houver API de hooks estável.
