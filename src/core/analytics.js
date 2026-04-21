/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */

import { suggestCurationForSession, actionIsExcludedByCuration } from './curation.js';

/**
 * @param {string | undefined} p
 */
function normPath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.replace(/\s+/g, ' ').trim().replace(/\\/g, '/');
}

/**
 * @typedef {object} SessionInsightsCounts
 * @property {number} total
 * @property {number} hallucinated
 * @property {number} inconsistent
 * @property {number} deadEndActions
 * @property {number} reworkActions
 * @property {number} included
 */

/**
 * @typedef {object} SessionInsightsDisplay
 * @property {string} hallucinationPct
 * @property {string} deadEndPct
 * @property {string} reworkPct
 * @property {string} successPct
 */

/**
 * @typedef {object} SessionInsights
 * @property {number} hallucinationRate
 * @property {number} deadEndRate
 * @property {number} reworkRate
 * @property {number} successSignal
 * @property {number} qualityScore
 * @property {'low' | 'medium' | 'high'} riskLevel
 * @property {string[]} timelineChips
 * @property {Record<string, string>} kpiLabels
 * @property {SessionInsightsCounts} counts
 * @property {SessionInsightsDisplay} display
 */

/**
 * @param {PicklejarSession} session
 * @returns {SessionInsights}
 */
export function computeSessionInsights(session) {
  const actions = session.actions ?? [];
  const total = actions.length;

  if (total === 0) {
    return {
      hallucinationRate: 0,
      deadEndRate: 0,
      reworkRate: 0,
      successSignal: 1,
      qualityScore: 100,
      riskLevel: 'low',
      timelineChips: [],
      kpiLabels: {
        hallucination: 'No actions yet.',
        deadEnd: 'No actions yet.',
        rework: 'No actions yet.',
        success: 'No actions yet.',
      },
      counts: {
        total: 0,
        hallucinated: 0,
        inconsistent: 0,
        deadEndActions: 0,
        reworkActions: 0,
        included: 0,
      },
      display: {
        hallucinationPct: '0%',
        deadEndPct: '0%',
        reworkPct: '0%',
        successPct: '100%',
      },
    };
  }

  const suggestions = suggestCurationForSession(session);
  const suggestedDeadEndIds = new Set(
    suggestions.filter((s) => s.suggestedStatus === 'dead_end').map((s) => s.id),
  );

  const seenFiles = new Set();
  let hallucinated = 0;
  let inconsistent = 0;
  let included = 0;
  let deadEndActions = 0;
  let reworkCount = 0;
  for (const a of actions) {
    const st = a.curationStatus ?? 'default';
    if (st === 'hallucinated') hallucinated += 1;
    if (st === 'inconsistent') inconsistent += 1;
    if (!actionIsExcludedByCuration(a)) included += 1;

    if (st === 'dead_end' || suggestedDeadEndIds.has(a.id)) deadEndActions += 1;

    const files = (a.relatedFiles ?? []).map(normPath).filter(Boolean);
    if (files.length > 0) {
      let touchedBefore = false;
      for (const f of files) {
        if (seenFiles.has(f)) {
          touchedBefore = true;
          break;
        }
      }
      if (touchedBefore) reworkCount += 1;
      for (const f of files) seenFiles.add(f);
    }
  }

  const hallucinationRate = (hallucinated + inconsistent) / total;
  const deadEndRate = deadEndActions / total;
  const reworkRate = reworkCount / total;
  const successSignal = included / total;

  const qualityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 *
          (0.35 * successSignal +
            0.25 * (1 - hallucinationRate) +
            0.2 * (1 - deadEndRate) +
            0.2 * (1 - reworkRate)),
      ),
    ),
  );

  /** @type {'low' | 'medium' | 'high'} */
  let riskLevel = 'low';
  if (hallucinationRate > 0.15 || deadEndRate > 0.35 || reworkRate > 0.45) {
    riskLevel = 'high';
  } else if (hallucinationRate > 0.08 || deadEndRate > 0.2 || reworkRate > 0.25 || successSignal < 0.6) {
    riskLevel = 'medium';
  }

  /** @type {string[]} */
  const timelineChips = [];
  if (reworkRate > 0.3) timelineChips.push('High rework');
  if (deadEndRate > 0.25 || hallucinationRate > 0.1) timelineChips.push('Low confidence');
  if (total > 80 && reworkRate > 0.2) timelineChips.push('Possible loop');

  const pct = (r) => `${Math.round(r * 100)}%`;

  return {
    hallucinationRate,
    deadEndRate,
    reworkRate,
    successSignal,
    qualityScore,
    riskLevel,
    timelineChips,
    kpiLabels: {
      hallucination:
        hallucinationRate > 0.1
          ? 'Elevated inconsistency or hallucination signals in tool outputs.'
          : 'Few or no flagged hallucination/inconsistency actions.',
      deadEnd:
        deadEndRate > 0.2
          ? 'Many abandoned or empty-output paths; consider pruning context.'
          : 'Dead-end ratio looks healthy.',
      rework:
        reworkRate > 0.3
          ? 'Frequent re-touches of the same files; possible thrashing.'
          : 'File churn across actions is moderate.',
      success:
        successSignal < 0.6
          ? 'Many actions are excluded from trusted context by curation.'
          : 'Most actions remain in the trusted set.',
    },
    counts: {
      total,
      hallucinated,
      inconsistent,
      deadEndActions,
      reworkActions: reworkCount,
      included,
    },
    display: {
      hallucinationPct: pct(hallucinationRate),
      deadEndPct: pct(deadEndRate),
      reworkPct: pct(reworkRate),
      successPct: pct(successSignal),
    },
  };
}

/**
 * @typedef {object} AgentAnalyticsRow
 * @property {string} agentOrigin
 * @property {number} sessionCount
 * @property {number} avgQualityScore
 * @property {number} avgHallucinationRate
 * @property {number} avgDeadEndRate
 * @property {number} avgReworkRate
 * @property {number} avgSuccessSignal
 */

/**
 * @param {Array<{ agentOrigin: string | null, sessionInsights: SessionInsights }>} rows
 * @returns {{ agents: AgentAnalyticsRow[], window: { label: string, fromMs: number | null, toMs: number } }}
 */
export function computeProjectInsights(rows) {
  /** @type {Map<string, { sessions: Array<{ agentOrigin: string | null, sessionInsights: SessionInsights }> }>} */
  const byAgent = new Map();
  for (const row of rows) {
    const key = row.agentOrigin && String(row.agentOrigin).trim() ? String(row.agentOrigin).trim() : 'unknown';
    if (!byAgent.has(key)) byAgent.set(key, { sessions: [] });
    byAgent.get(key).sessions.push(row);
  }

  /** @type {AgentAnalyticsRow[]} */
  const agents = [];
  for (const [agentOrigin, { sessions }] of byAgent) {
    const n = sessions.length;
    if (n === 0) continue;
    let sq = 0;
    let h = 0;
    let d = 0;
    let r = 0;
    let s = 0;
    for (const sess of sessions) {
      const ins = sess.sessionInsights;
      sq += ins.qualityScore;
      h += ins.hallucinationRate;
      d += ins.deadEndRate;
      r += ins.reworkRate;
      s += ins.successSignal;
    }
    agents.push({
      agentOrigin,
      sessionCount: n,
      avgQualityScore: Math.round(sq / n),
      avgHallucinationRate: h / n,
      avgDeadEndRate: d / n,
      avgReworkRate: r / n,
      avgSuccessSignal: s / n,
    });
  }

  agents.sort((a, b) => b.avgQualityScore - a.avgQualityScore);
  return {
    agents,
    window: { label: 'all', fromMs: null, toMs: Date.now() },
  };
}

/**
 * @param {number} updatedAt
 * @param {string} window - '7d' | '30d' | 'all'
 * @param {number} [now]
 */
export function sessionMatchesWindow(updatedAt, window, now = Date.now()) {
  if (window === 'all') return true;
  const day = 24 * 60 * 60 * 1000;
  const ms = window === '7d' ? 7 * day : window === '30d' ? 30 * day : 0;
  if (ms <= 0) return true;
  return updatedAt >= now - ms;
}
