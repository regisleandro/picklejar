/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */
/** @typedef {import('../types/index.d.ts').TaskNode} TaskNode */

/**
 * Very rough token estimate for budgeting output size.
 * @param {string} s
 */
export function estimateTokens(s) {
  return Math.ceil(s.length / 4);
}

/**
 * @param {TaskNode} node
 * @param {number} depth
 * @param {string[]} stopAt - task ids marked as "stopped here" (optional)
 */
function formatTaskNode(node, depth = 0, stopAt = []) {
  const pad = '  '.repeat(depth);
  const box = node.status === 'done' ? '[x]' : node.status === 'failed' ? '[!]' : '[ ]';
  const here = stopAt.includes(node.id) ? '  <-- PAROU AQUI' : '';
  let lines = [`${pad}- ${box} ${node.description}${here}`];
  for (const st of node.subtasks ?? []) {
    lines = lines.concat(formatTaskNode(st, depth + 1, stopAt));
  }
  return lines;
}

/**
 * @param {PicklejarSession} session
 */
function formatTaskTree(session) {
  if (!session.taskTree?.length) return '_ (task tree vazia)_';
  const stopAt =
    session.taskTree.length > 0
      ? [session.taskTree.find((n) => n.status === 'in_progress')?.id].filter(Boolean)
      : [];
  return session.taskTree.flatMap((n) => formatTaskNode(n, 0, stopAt)).join('\n');
}

/**
 * @param {PicklejarSession} session
 * @param {{ maxTokens?: number }} [opts]
 */
export function compileBrainDump(session, opts = {}) {
  const maxTokens = opts.maxTokens ?? 30_000;
  const lines = [];

  lines.push(`# [PICKLEJAR RESUME] Sessão ${session.sessionId}`);
  lines.push('');
  lines.push('## ERRO / MOTIVO DA INTERRUPÇÃO');
  lines.push(session.lastError ?? 'Sessão retomada normalmente');
  lines.push('');
  lines.push('## PRÓXIMA AÇÃO PLANEJADA');
  lines.push(session.lastPlannedAction ?? 'Não identificada');
  lines.push('');
  lines.push('## OBJETIVO');
  lines.push(session.goal || '(não definido)');
  lines.push('');
  lines.push('## PROGRESSO');
  lines.push(formatTaskTree(session));
  lines.push('');
  lines.push('## DECISÕES DE ARQUITETURA');
  if (!session.decisions?.length) {
    lines.push('_ (nenhuma registrada)_');
  } else {
    for (const d of session.decisions) {
      lines.push(`- ${d.description} — _${d.reasoning}_ (${new Date(d.timestamp).toISOString()})`);
    }
  }
  lines.push('');
  lines.push('## ARQUIVOS ATIVOS');
  if (!session.activeFiles?.length) {
    lines.push('_ (nenhum)_');
  } else {
    for (const f of session.activeFiles) {
      lines.push(`### ${f.path}`);
      lines.push('```');
      lines.push(f.content);
      lines.push('```');
    }
  }

  const actions = session.actions ?? [];
  const detailed = actions.slice(-15);
  const older = actions.slice(0, Math.max(0, actions.length - 15));

  lines.push('');
  lines.push('## ÚLTIMAS AÇÕES');
  for (const a of detailed) {
    const t = new Date(a.timestamp).toISOString();
    lines.push(`- [${a.toolName}] ${a.relatedFiles?.join(', ') || JSON.stringify(a.input).slice(0, 120)} (${t})`);
  }

  lines.push('');
  lines.push('## HISTÓRICO RESUMIDO');
  if (older.length === 0) {
    lines.push('_ (sem ações antigas além das últimas)_');
  } else {
    const byTool = older.reduce((acc, a) => {
      acc[a.toolName] = (acc[a.toolName] ?? 0) + 1;
      return acc;
    }, {});
    lines.push(`${older.length} ações anteriores — por ferramenta: ${JSON.stringify(byTool)}`);
    for (const a of older) {
      lines.push(
        `- [${a.toolName}] ${a.relatedFiles?.[0] ?? ''}`.trim(),
      );
    }
  }

  lines.push('');
  lines.push('Continue a partir do ponto de interrupção.');

  let md = lines.join('\n');
  if (estimateTokens(md) <= maxTokens) return md;

  // Priority trim: shrink summarized history, then large files, then old single-line actions
  md = trimToTokenBudget(session, maxTokens);
  return md;
}

/**
 * @param {PicklejarSession} session
 * @param {number} maxTokens
 */
function trimToTokenBudget(session, maxTokens) {
  const maxChars = maxTokens * 4;
  const headParts = [];

  headParts.push(`# [PICKLEJAR RESUME] Sessão ${session.sessionId}\n`);
  headParts.push(`## ERRO / MOTIVO DA INTERRUPÇÃO\n${session.lastError ?? 'Sessão retomada normalmente'}\n\n`);
  headParts.push(
    `## PRÓXIMA AÇÃO PLANEJADA\n${session.lastPlannedAction ?? 'Não identificada'}\n\n`,
  );
  headParts.push(`## OBJETIVO\n${session.goal || '(não definido)'}\n\n`);
  headParts.push(`## PROGRESSO\n${formatTaskTree(session)}\n\n`);
  headParts.push('## DECISÕES DE ARQUITETURA\n');
  headParts.push(
    session.decisions?.length
      ? session.decisions.map((d) => `- ${d.description}`).join('\n')
      : '_ (nenhuma)_',
  );
  headParts.push('\n\n');

  let body = headParts.join('');
  const filesSection = formatActiveFilesTrimmed(session.activeFiles ?? [], maxChars - body.length - 2000);
  body += `## ARQUIVOS ATIVOS\n${filesSection}\n\n`;

  const actions = session.actions ?? [];
  const detailed = actions.slice(-15);
  const older = actions.slice(0, Math.max(0, actions.length - 15));

  let actionsText = '## ÚLTIMAS AÇÕES\n';
  for (const a of detailed) {
    actionsText += `- [${a.toolName}] ${truncateStr(a.output, 400)}\n`;
  }
  actionsText += '\n## HISTÓRICO RESUMIDO\n';
  actionsText += `${older.length} ações — resumo omitido para caber no orçamento.\n`;
  body += actionsText;
  body += '\nContinue a partir do ponto de interrupção.';

  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + '\n\n… [PICKLEJAR: truncado por maxTokens] …\n';
  }
  return body;
}

/**
 * @param {import('../types/index.d.ts').FileSnapshot[]} files
 * @param {number} budgetChars
 */
function formatActiveFilesTrimmed(files, budgetChars) {
  if (!files.length) return '_ (nenhum)_';
  let used = 0;
  const out = [];
  for (const f of files) {
    const header = `### ${f.path}\n\`\`\`\n`;
    const room = Math.max(0, budgetChars - used - header.length - 5);
    let content = f.content;
    if (content.length > room) {
      content =
        content.slice(0, Math.floor(room * 0.55)) +
        '\n…\n' +
        content.slice(-Math.floor(room * 0.35));
    }
    const block = `${header}${content}\n\`\`\`\n`;
    used += block.length;
    out.push(block);
    if (used >= budgetChars) break;
  }
  return out.join('\n') || '_ (omitidos por tamanho)_';
}

/**
 * @param {string} s
 * @param {number} max
 */
function truncateStr(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
