#!/usr/bin/env node
/**
 * TEMPORARY — apague depois de usar.
 *
 * Regrava `.picklejar/export-<sessionId>.md` para cada sessão com snapshot,
 * usando o `compileBrainDump` atual (H1 + título derivado).
 *
 * Uso (recomendado a partir da raiz do repositório picklejar):
 *   node scripts/refresh-export-titles.mjs
 *   node scripts/refresh-export-titles.mjs /caminho/do/projeto-com-.picklejar
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { listSnapshots, loadSnapshot } from '../src/core/snapshot.js';
import { compileBrainDump } from '../src/core/compiler.js';
import { loadConfig } from '../src/core/config.js';
import { picklejarRoot } from '../src/core/paths.js';

async function main() {
  const projectDir = path.resolve(process.argv[2] ?? process.cwd());
  const pjRoot = picklejarRoot(projectDir);
  const rows = await listSnapshots(projectDir);
  const seen = new Set();
  const ids = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const id = rows[i].sessionId;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const cfg = await loadConfig(projectDir);
  let n = 0;
  for (const sessionId of ids) {
    const loaded = await loadSnapshot(projectDir, sessionId);
    if (!loaded) continue;
    const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens });
    const outPath = path.join(pjRoot, `export-${sessionId}.md`);
    await fs.mkdir(pjRoot, { recursive: true });
    await fs.writeFile(outPath, md, 'utf8');
    console.log('Wrote', outPath);
    n += 1;
  }
  if (n === 0) console.log('No sessions found in', projectDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
