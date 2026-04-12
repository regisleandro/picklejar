/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */
/** @typedef {import('../types/index.d.ts').TaskNode} TaskNode */

import {
  actionIncludedInProfile,
  actionIsExcludedByCuration,
  actionPriority,
  normalizeCurationProfile,
} from './curation.js';
import { deriveSessionTitle } from './list-summary.js';

export const DEFAULT_BRAIN_DUMP_SECTIONS = Object.freeze({
  goal: true,
  nextPlannedAction: true,
  lastError: true,
  progress: true,
  decisions: true,
  activeFiles: true,
  recentActions: true,
  summarizedHistory: true,
  discardedPaths: false,
  resumeInstructions: true,
});

/**
 * Very rough token estimate for budgeting output size.
 * @param {string} s
 */
export function estimateTokens(s) {
  return Math.ceil(s.length / 4);
}

/**
 * @param {unknown} value
 */
function stringifyValue(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {PicklejarSession['actions'][number]} action
 */
function actionSummary(action) {
  const inputSummary =
    action.relatedFiles?.join(', ') || stringifyValue(action.input).slice(0, 120) || '(no input)';
  return inputSummary;
}

/**
 * @param {{ sections?: Partial<typeof DEFAULT_BRAIN_DUMP_SECTIONS>, excludeActionIndexes?: number[], ignoreCuration?: boolean, curationProfile?: string }} [opts]
 */
export function normalizeBrainDumpOptions(opts = {}) {
  const sections = {
    ...DEFAULT_BRAIN_DUMP_SECTIONS,
    ...(opts.sections ?? {}),
  };
  const excludeActionIndexes = [...new Set((opts.excludeActionIndexes ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  return {
    sections,
    excludeActionIndexes,
    ignoreCuration: Boolean(opts.ignoreCuration),
    curationProfile: normalizeCurationProfile(opts.curationProfile) ?? 'balanced',
  };
}

/**
 * @param {PicklejarSession} session
 * @param {{ excludeActionIndexes?: number[], ignoreCuration?: boolean, curationProfile?: string }} [opts]
 */
function filterSessionActions(session, opts = {}) {
  const exclude = new Set(opts.excludeActionIndexes ?? []);
  const ignoreCuration = Boolean(opts.ignoreCuration);
  const profile = normalizeCurationProfile(opts.curationProfile) ?? 'balanced';
  if (exclude.size === 0 && ignoreCuration && profile === 'balanced') return session;
  const actions = (session.actions ?? []).filter((action, idx) => {
    if (exclude.has(idx + 1)) return false;
    if (!actionIncludedInProfile(action, profile, ignoreCuration)) return false;
    return true;
  });
  const related = new Set(
    actions.flatMap((action) => Array.isArray(action.relatedFiles) ? action.relatedFiles : []),
  );
  return {
    ...session,
    actions,
    activeFiles:
      related.size === 0
        ? session.activeFiles
        : (session.activeFiles ?? []).filter((file) => related.has(file.path)),
  };
}

/**
 * @param {PicklejarSession} session
 */
export function listSelectableActions(session) {
  return (session.actions ?? []).map((action, idx) => ({
    index: idx + 1,
    id: action.id,
    timestamp: action.timestamp,
    toolName: action.toolName,
    summary: actionSummary(action),
    curationStatus: action.curationStatus ?? 'default',
    includeInBrainDump: !actionIsExcludedByCuration(action),
    curationNote: action.curationNote ?? '',
  }));
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
 */
function formatTrustedState(session) {
  const lines = [
    `- Trusted actions retained: ${session.actions?.length ?? 0}`,
    `- Active files retained: ${session.activeFiles?.length ?? 0}`,
    `- Decisions recorded: ${session.decisions?.length ?? 0}`,
  ];
  if (session.lastPlannedAction) {
    lines.push(`- Next recommended action: ${session.lastPlannedAction}`);
  }
  if (session.lastError) {
    lines.push(`- Interruption reason: ${session.lastError}`);
  }
  return lines.join('\n');
}

/**
 * @param {PicklejarSession} session
 * @param {{ excludeActionIndexes?: number[], ignoreCuration?: boolean, curationProfile?: string }} [opts]
 */
function collectDiscardedActions(session, opts = {}) {
  const exclude = new Set(opts.excludeActionIndexes ?? []);
  const ignoreCuration = Boolean(opts.ignoreCuration);
  const profile = normalizeCurationProfile(opts.curationProfile) ?? 'balanced';
  if (ignoreCuration) return [];
  return (session.actions ?? [])
    .map((action, idx) => ({ action, index: idx + 1 }))
    .filter(({ action, index }) =>
      exclude.has(index) ||
      actionIsExcludedByCuration(action) ||
      !actionIncludedInProfile(action, profile, false),
    );
}

/**
 * @param {PicklejarSession} session
 * @param {{ maxTokens?: number, onTruncate?: (info: { estimatedTokens: number, maxTokens: number, omittedSections: string[] }) => void }} [opts]
 */
export function compileBrainDump(session, opts = {}) {
  const maxTokens = opts.maxTokens ?? 30_000;
  const onTruncate = typeof opts.onTruncate === 'function' ? opts.onTruncate : null;
  const { sections, excludeActionIndexes, ignoreCuration, curationProfile } = normalizeBrainDumpOptions(opts);
  const filteredSession = filterSessionActions(session, { excludeActionIndexes, ignoreCuration, curationProfile });
  const discardedActions = collectDiscardedActions(session, { excludeActionIndexes, ignoreCuration, curationProfile });
  const lines = [];

  lines.push(`# [PICKLEJAR RESUME] ${deriveSessionTitle(filteredSession)}`);
  lines.push(`> Session: ${filteredSession.sessionId}`);
  lines.push('');
  if (sections.resumeInstructions) {
    lines.push('**IMPORTANT: You are resuming a previous session. When the user sends their first message, you MUST start by briefly acknowledging you have context from the previous session and summarize what was being worked on before continuing.**');
    lines.push('');
  }
  if (sections.goal) {
    lines.push('## USER ORIGINAL INTENT');
    lines.push(filteredSession.goal || '(not captured)');
    lines.push('');
  }
  lines.push('## CURRENT TRUSTED STATE');
  lines.push(formatTrustedState(filteredSession));
  lines.push('');
  if (sections.nextPlannedAction) {
    lines.push('## NEXT PLANNED ACTION');
    lines.push(filteredSession.lastPlannedAction ?? 'Not identified');
    lines.push('');
  }
  if (sections.lastError) {
    lines.push('## ERROR / REASON FOR INTERRUPTION');
    lines.push(filteredSession.lastError ?? 'Session resumed normally');
    lines.push('');
  }
  if (sections.progress) {
    lines.push('## PROGRESS');
    lines.push(formatTaskTree(filteredSession));
    lines.push('');
  }
  if (sections.decisions) {
    lines.push('## ARCHITECTURE DECISIONS');
    if (!filteredSession.decisions?.length) {
      lines.push('_(none recorded)_');
    } else {
      for (const d of filteredSession.decisions) {
        lines.push(`- ${d.description} — _${d.reasoning}_ (${new Date(d.timestamp).toISOString()})`);
      }
    }
    lines.push('');
  }
  if (sections.activeFiles) {
    lines.push('## ACTIVE FILES');
    if (!filteredSession.activeFiles?.length) {
      lines.push('_(none)_');
    } else {
      for (const f of filteredSession.activeFiles) {
        lines.push(`### ${f.path}`);
        lines.push('```');
        lines.push(f.content);
        lines.push('```');
      }
    }
  }

  const actions = filteredSession.actions ?? [];
  const detailed = actions.slice(-15);
  const older = actions.slice(0, Math.max(0, actions.length - 15));

  if (sections.recentActions) {
    lines.push('');
    lines.push('## RECENT TRUSTED ACTIONS');
    for (const a of detailed) {
      const t = new Date(a.timestamp).toISOString();
      lines.push(`- [${a.toolName}] ${actionSummary(a)} (${t})`);
    }
  }

  if (sections.summarizedHistory) {
    lines.push('');
    lines.push('## TRUSTED HISTORY');
    if (older.length === 0) {
      lines.push('_(no older actions beyond the recent ones)_');
    } else {
      const byTool = older.reduce((acc, a) => {
        acc[a.toolName] = (acc[a.toolName] ?? 0) + 1;
        return acc;
      }, {});
      lines.push(`${older.length} previous actions — by tool: ${JSON.stringify(byTool)}`);
      for (const a of older) {
        lines.push(`- [${a.toolName}] ${a.relatedFiles?.[0] ?? ''}`.trim());
      }
    }
  }

  if (sections.discardedPaths) {
    lines.push('');
    lines.push('## DISCARDED PATHS');
    if (discardedActions.length === 0) {
      lines.push('_(none)_');
    } else {
      for (const { action, index } of discardedActions) {
        const status = action.curationStatus ?? 'discarded';
        const note = action.curationNote ? ` — ${action.curationNote}` : '';
        lines.push(`- #${index} [${action.toolName}] ${actionSummary(action)} (${status})${note}`);
      }
    }
  }

  if (sections.resumeInstructions) {
    lines.push('');
    lines.push('INSTRUCTION: Continue from the interruption point. On first user message, acknowledge this resumed context before proceeding.');
  }

  let md = lines.join('\n');
  if (estimateTokens(md) <= maxTokens) return md;

  // Priority trim: shrink summarized history, then large files, then old single-line actions
  const estimatedTokens = estimateTokens(md);
  const omittedSections = [];
  if (sections.summarizedHistory) omittedSections.push('summarizedHistory');
  if (sections.activeFiles && filteredSession.activeFiles?.length) omittedSections.push('activeFiles (truncated)');
  if (sections.discardedPaths) omittedSections.push('discardedPaths');
  onTruncate?.({ estimatedTokens, maxTokens, omittedSections });

  md = trimToTokenBudget(filteredSession, maxTokens, sections);
  return md;
}

/**
 * @param {PicklejarSession} session
 * @param {number} maxTokens
 * @param {typeof DEFAULT_BRAIN_DUMP_SECTIONS} sections
 */
function trimToTokenBudget(session, maxTokens, sections) {
  const maxChars = maxTokens * 4;
  const headParts = [];

  headParts.push(`# [PICKLEJAR RESUME] ${deriveSessionTitle(session)}\n`);
  headParts.push(`> Session: ${session.sessionId}\n\n`);
  if (sections.resumeInstructions) {
    headParts.push('**IMPORTANT: You are resuming a previous session. When the user sends their first message, you MUST start by briefly acknowledging you have context from the previous session and summarize what was being worked on before continuing.**\n\n');
  }
  if (sections.goal) headParts.push(`## USER ORIGINAL INTENT\n${session.goal || '(not captured)'}\n\n`);
  headParts.push(`## CURRENT TRUSTED STATE\n${formatTrustedState(session)}\n\n`);
  if (sections.nextPlannedAction) {
    headParts.push(`## NEXT PLANNED ACTION\n${session.lastPlannedAction ?? 'Not identified'}\n\n`);
  }
  if (sections.lastError) {
    headParts.push(`## ERROR / REASON FOR INTERRUPTION\n${session.lastError ?? 'Session resumed normally'}\n\n`);
  }
  if (sections.progress) headParts.push(`## PROGRESS\n${formatTaskTree(session)}\n\n`);
  if (sections.decisions) {
    headParts.push('## ARCHITECTURE DECISIONS\n');
    headParts.push(
      session.decisions?.length
        ? session.decisions.map((d) => `- ${d.description}`).join('\n')
        : '_(none)_',
    );
    headParts.push('\n\n');
  }

  let body = headParts.join('');
  if (sections.activeFiles) {
    const filesSection = formatActiveFilesTrimmed(session.activeFiles ?? [], maxChars - body.length - 2000);
    body += `## ACTIVE FILES\n${filesSection}\n\n`;
  }

  const actions = session.actions ?? [];
  const prioritizedActions = prioritizeActions(actions);
  const detailed = prioritizedActions.slice(0, 15);
  const detailedIds = new Set(detailed.map((action) => action.id));
  const older = actions.filter((action) => !detailedIds.has(action.id));

  if (sections.recentActions) {
    let actionsText = '## RECENT TRUSTED ACTIONS\n';
    for (const a of detailed) {
      const outputStr = stringifyValue(a.output);
      actionsText += `- [${a.toolName}] ${truncateStr(outputStr, 400)}\n`;
    }
    body += actionsText;
    body += '\n';
  }
  if (sections.summarizedHistory) {
    body += '## TRUSTED HISTORY\n';
    body += `${older.length} actions — summary omitted to fit token budget.\n`;
  }
  if (sections.discardedPaths) {
    body += '## DISCARDED PATHS\n';
    body += 'Discarded path summaries omitted to fit token budget.\n';
  }
  if (sections.resumeInstructions) {
    body += '\nINSTRUCTION: Continue from the interruption point. On first user message, acknowledge this resumed context before proceeding.';
  }

  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + '\n\n... [PICKLEJAR: truncated by maxTokens] ...\n';
  }
  return body;
}

/**
 * Prefer confirmed actions first when the dump has to be compressed.
 * Keep stable ordering inside the same priority tier.
 * @param {PicklejarSession['actions']} actions
 */
function prioritizeActions(actions) {
  return actions
    .map((action, idx) => ({ action, idx }))
    .sort((a, b) => {
      const byPriority = actionPriority(b.action) - actionPriority(a.action);
      if (byPriority !== 0) return byPriority;
      return a.idx - b.idx;
    })
    .map(({ action }) => action);
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
