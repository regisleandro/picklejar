#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = "/Users/regisleandro/projetos/picklejar";
const hookName = process.argv[2];
if (!hookName) {
  console.error('picklejar run-hook: missing hook name');
  process.exit(1);
}
const target = join(pkgRoot, 'src', 'hooks', `${hookName}.js`);
const child = spawn(process.execPath, [target], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
