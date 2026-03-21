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
  const here = stopAt.includes(node.id) ? '  <-- STOPPED HERE' : '';
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
  if (!session.taskTree?.length) return '_(empty task tree)_';
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

  lines.push(`# [PICKLEJAR RESUME] Session ${session.sessionId}`);
  lines.push('');
  lines.push('**IMPORTANT: You are resuming a previous session. When the user sends their first message, you MUST start by briefly acknowledging you have context from the previous session and summarize what was being worked on before continuing.**');
  lines.push('');
  lines.push('## USER ORIGINAL INTENT');
  lines.push(session.goal || '(not captured)');
  lines.push('');
  lines.push('## NEXT PLANNED ACTION');
  lines.push(session.lastPlannedAction ?? 'Not identified');
  lines.push('');
  lines.push('## ERROR / REASON FOR INTERRUPTION');
  lines.push(session.lastError ?? 'Session resumed normally');
  lines.push('');
  lines.push('## PROGRESS');
  lines.push(formatTaskTree(session));
  lines.push('');
  lines.push('## ARCHITECTURE DECISIONS');
  if (!session.decisions?.length) {
    lines.push('_(none recorded)_');
  } else {
    for (const d of session.decisions) {
      lines.push(`- ${d.description} — _${d.reasoning}_ (${new Date(d.timestamp).toISOString()})`);
    }
  }
  lines.push('');
  lines.push('## ACTIVE FILES');
  if (!session.activeFiles?.length) {
    lines.push('_(none)_');
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
  lines.push('## RECENT ACTIONS');
  for (const a of detailed) {
    const t = new Date(a.timestamp).toISOString();
    const inputSummary =
      a.relatedFiles?.join(', ') ||
      (typeof a.input === 'string' ? a.input : JSON.stringify(a.input)).slice(0, 120);
    lines.push(`- [${a.toolName}] ${inputSummary} (${t})`);
  }

  lines.push('');
  lines.push('## SUMMARIZED HISTORY');
  if (older.length === 0) {
    lines.push('_(no older actions beyond the recent ones)_');
  } else {
    const byTool = older.reduce((acc, a) => {
      acc[a.toolName] = (acc[a.toolName] ?? 0) + 1;
      return acc;
    }, {});
    lines.push(`${older.length} previous actions — by tool: ${JSON.stringify(byTool)}`);
    for (const a of older) {
      lines.push(
        `- [${a.toolName}] ${a.relatedFiles?.[0] ?? ''}`.trim(),
      );
    }
  }

  lines.push('');
  lines.push('INSTRUCTION: Continue from the interruption point. On first user message, acknowledge this resumed context before proceeding.');

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

  headParts.push(`# [PICKLEJAR RESUME] Session ${session.sessionId}\n`);
  headParts.push('**IMPORTANT: You are resuming a previous session. When the user sends their first message, you MUST start by briefly acknowledging you have context from the previous session and summarize what was being worked on before continuing.**\n\n');
  headParts.push(`## USER ORIGINAL INTENT\n${session.goal || '(not captured)'}\n\n`);
  headParts.push(
    `## NEXT PLANNED ACTION\n${session.lastPlannedAction ?? 'Not identified'}\n\n`,
  );
  headParts.push(`## ERROR / REASON FOR INTERRUPTION\n${session.lastError ?? 'Session resumed normally'}\n\n`);
  headParts.push(`## PROGRESS\n${formatTaskTree(session)}\n\n`);
  headParts.push('## ARCHITECTURE DECISIONS\n');
  headParts.push(
    session.decisions?.length
      ? session.decisions.map((d) => `- ${d.description}`).join('\n')
      : '_(none)_',
  );
  headParts.push('\n\n');

  let body = headParts.join('');
  const filesSection = formatActiveFilesTrimmed(session.activeFiles ?? [], maxChars - body.length - 2000);
  body += `## ACTIVE FILES\n${filesSection}\n\n`;

  const actions = session.actions ?? [];
  const detailed = actions.slice(-15);
  const older = actions.slice(0, Math.max(0, actions.length - 15));

  let actionsText = '## RECENT ACTIONS\n';
  for (const a of detailed) {
    const outputStr = typeof a.output === 'string' ? a.output : JSON.stringify(a.output);
    actionsText += `- [${a.toolName}] ${truncateStr(outputStr, 400)}\n`;
  }
  actionsText += '\n## SUMMARIZED HISTORY\n';
  actionsText += `${older.length} actions — summary omitted to fit token budget.\n`;
  body += actionsText;
  body += '\nINSTRUCTION: Continue from the interruption point. On first user message, acknowledge this resumed context before proceeding.';

  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + '\n\n… [PICKLEJAR: truncated by maxTokens] …\n';
  }
  return body;
}

/**
 * @param {import('../types/index.d.ts').FileSnapshot[]} files
 * @param {number} budgetChars
 */
function formatActiveFilesTrimmed(files, budgetChars) {
  if (!files.length) return '_(none)_';
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
  return out.join('\n') || '_(omitted due to size)_';
}

/**
 * @param {string} s
 * @param {number} max
 */
function truncateStr(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
