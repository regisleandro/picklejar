/**
 * @param {string} packageRoot - absolute path to picklejar-agent root
 */
export function runHookScript(packageRoot) {
  const rootJson = JSON.stringify(packageRoot);
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = ${rootJson};
const hookName = process.argv[2];
if (!hookName) {
  console.error('picklejar run-hook: missing hook name');
  process.exit(1);
}
const target = join(pkgRoot, 'src', 'hooks', \`\${hookName}.js\`);
const child = spawn(process.execPath, [target], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
`;
}

/**
 * Uses CLAUDE_PROJECT_DIR so paths work in Claude Code.
 */
export function claudeHooksBlock() {
  const run = `node $CLAUDE_PROJECT_DIR/.picklejar/hooks/run-hook.js`;
  return {
    SessionStart: [
      {
        matcher: 'resume',
        hooks: [
          {
            type: 'command',
            command: `${run} session-start`,
          },
        ],
      },
      {
        matcher: 'startup',
        hooks: [
          {
            type: 'command',
            command: `${run} session-start`,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `${run} post-tool-use`,
            async: true,
          },
        ],
      },
    ],
    PreCompact: [
      {
        hooks: [
          {
            type: 'command',
            command: `${run} pre-compact`,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: `${run} stop`,
            async: true,
          },
        ],
      },
    ],
    SessionEnd: [
      {
        hooks: [
          {
            type: 'command',
            command: `${run} session-end`,
          },
        ],
      },
    ],
  };
}
