import { claudeHooksBlock } from './init-templates.js';

/**
 * Cursor project hooks — commands run from repo root.
 * @returns {Record<string, unknown>}
 */
export function cursorPicklejarHooksDoc() {
  const cmd = 'node .picklejar/hooks/run-hook.js';
  return {
    version: 1,
    hooks: {
      sessionStart: [{ command: `${cmd} session-start` }],
      sessionEnd: [{ command: `${cmd} session-end` }],
      postToolUse: [{ command: `${cmd} post-tool-use`, matcher: '*' }],
      preCompact: [{ command: `${cmd} pre-compact` }],
      stop: [{ command: `${cmd} stop` }],
    },
  };
}

/** Same hook graph as Claude Code for Continue CLI settings merge */
export function continueHooksBlock() {
  return claudeHooksBlock('continue');
}

/**
 * Copilot CLI hook file content (`.github/hooks/picklejar-agent.json`).
 */
export function copilotPicklejarHooksJson() {
  return {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: 'command',
          bash: './scripts/picklejar-session-start.sh',
          powershell: './scripts/picklejar-session-start.ps1',
          cwd: '.github/hooks',
          timeoutSec: 120,
        },
      ],
      postToolUse: [
        {
          type: 'command',
          bash: './scripts/picklejar-post-tool-use.sh',
          powershell: './scripts/picklejar-post-tool-use.ps1',
          cwd: '.github/hooks',
          timeoutSec: 120,
        },
      ],
      preCompact: [
        {
          type: 'command',
          bash: './scripts/picklejar-pre-compact.sh',
          powershell: './scripts/picklejar-pre-compact.ps1',
          cwd: '.github/hooks',
          timeoutSec: 120,
        },
      ],
    },
  };
}

/** @param {string} hook - e.g. post-tool-use */
export function copilotHookShellScriptFor(hook) {
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd)"
export PICKLEJAR_PROJECT_DIR="$ROOT"
export PICKLEJAR_AGENT_ORIGIN="copilot"
exec node "$ROOT/.picklejar/hooks/run-hook.js" ${hook}
`;
}

/** @param {string} hook */
export function copilotHookPowerShellScriptFor(hook) {
  return `$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..")).Path
$env:PICKLEJAR_PROJECT_DIR = $Root
$env:PICKLEJAR_AGENT_ORIGIN = "copilot"
& node "$Root\\.picklejar\\hooks\\run-hook.js" ${hook}
`;
}

const CLINE_HOOK_TARGETS = [
  { file: 'PostToolUse', hook: 'post-tool-use' },
  { file: 'PreCompact', hook: 'pre-compact' },
  { file: 'TaskStart', hook: 'session-start' },
  { file: 'TaskResume', hook: 'session-start' },
  { file: 'TaskComplete', hook: 'session-end' },
];

/**
 * @returns {Array<{ relativePath: string, content: string, mode?: number }>}
 */
export function clineHookFiles() {
  const body = (hook) => `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
export PICKLEJAR_PROJECT_DIR="$ROOT"
export PICKLEJAR_AGENT_ORIGIN="cline"
exec node "$ROOT/.picklejar/hooks/run-hook.js" ${hook}
`;
  return CLINE_HOOK_TARGETS.map(({ file, hook }) => ({
    relativePath: `.clinerules/hooks/${file}`,
    content: body(hook),
    mode: 0o755,
  }));
}
