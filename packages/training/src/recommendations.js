import { reviewQueue } from './reviews.js';
import { weakestSkillCells, skillCellFromId, SKILL_MIN_SAMPLES } from './skills.js';
import { plateauBranch, skillCoverage } from './plateau.js';
import { impactCandidates } from './impact.js';

/**
 * Progress-based recommendations (F38, M2 slice 6). One merged, deterministic list built from the
 * record's own evidence — the already-implemented surfaces (due pattern reviews, weakest gated
 * skill cells, plateau branch, impact candidates, coverage) are fused instead of being a pile of
 * single-surface nudges. item kinds replace each other; the order is: (a) at-or-overdue spaced
 * reviews first, (b) weakest gated cells not already covered by a review, (c) the plateau branch
 * when one exists — a protocol to run, not a treatment, (d) the top estimated-impact candidate
 * that is not already on the list, and (e) a coverage nudge only when everything else is empty so
 * a sparse history still gets an honest "what to check next" instead of fabricated homework.
 *
 * Items carry `evidence` lines (what was measured, how many solves) and `launch` data the UI maps
 * to existing buttons (pattern drills with the F18 tier, the gauntlet panel, the benchmark
 * preset). Nothing here claims an intervention efficacy — each `why` names its numbers and the
 * framework's caveats. Pure; `now` is explicit so the list is reproducible in tests.
 */

const DAY_MS = 86400000;

function fmtWhen(iso, nowMs) {
  const parsed = Date.parse(iso ?? '');
  if (!Number.isFinite(parsed) || !Number.isFinite(nowMs)) return null;
  const deltaDays = Math.round((nowMs - parsed) / DAY_MS);
  if (deltaDays <= 0) return 'due today';
  if (deltaDays === 1) return 'was due 1 day ago';
  return `was due ${deltaDays} days ago`;
}

export function buildRecommendations({ sessions, reviews = [], now, limit = 4, minSamples = SKILL_MIN_SAMPLES } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new RangeError('buildRecommendations needs a valid now (ISO string or ms)');
  const items = [];
  const covered = new Set();

  const queue = reviewQueue(reviews, nowMs);
  for (const due of queue.due.slice(0, limit)) {
    covered.add(due.id);
    items.push({
      id: `review:${due.id}`,
      kind: 'review',
      title: `Review repetition ready: ${due.label}`,
      why: `This skill pattern was due on schedule (ladder interval ${due.record?.intervalDays} days, ${fmtWhen(due.nextReviewAt, nowMs)}); a completed drill that lands at-or-under your fast line keeps it on the ladder.`,
      evidence: [`next review was scheduled for ${due.record?.nextReviewAt}`, `streak: ${due.record?.successes} up, last ${due.record?.intervalDays}-day interval`],
      launch: { type: 'drill', cell: { op: due.op, label: due.label, rowRange: due.rowRange, colRange: due.colRange, id: due.id }, record: due.record },
    });
  }
  if (!items.length) covered.clear();

  for (const cell of weakestSkillCells(sessions, { scope: 'all', limit: 2, minSamples })) {
    if (covered.has(cell.id)) continue;
    covered.add(cell.id);
    items.push({
      id: `weak:${cell.id}`,
      kind: 'weak-cell',
      title: `Slowest reliable pattern: ${cell.label}`,
      why: `×${cell.ratio.toFixed(2)} your ${cell.op} median over ${cell.count} solves (shrunken, sample-gated). A 60 s pattern drill is the cheapest test of whether it is trainable.`,
      evidence: [`cell median ${(cell.medianMs / 1000).toFixed(2)}s vs ${cell.op} median ${(cell.opMedianMs / 1000).toFixed(2)}s`, `${cell.count} solves (${cell.evidence})`],
      launch: { type: 'drill', cell: { op: cell.op, label: cell.label, rowRange: cell.rowRange, colRange: cell.colRange, id: cell.id }, record: null },
    });
  }

  const plateau = plateauBranch(sessions);
  if (plateau.branch) {
    items.push({
      id: `plateau:${plateau.branch.name}`,
      kind: 'plateau',
      title: `Plateau protocol available: ${plateau.branch.name}`,
      why: plateau.branch.why,
      evidence: plateau.branch.actions,
      launch: { type: 'panel', panel: 'gauntlet', actions: plateau.branch.actions },
    });
  }

  const impacts = impactCandidates(sessions);
  for (const cand of impacts.candidates) {
    if (items.length >= limit) break;
    if (covered.has(cand.id)) continue;
    covered.add(cand.id);
    const launchCell = cand.kind === 'cell' ? skillCellFromId(cand.id) : null;
    items.push({
      id: `impact:${cand.kind}:${cand.id}`,
      kind: 'impact',
      title: `Estimated payoff if closed: ${cand.label}`,
      why: `≈ +${cand.estDelta.toFixed(1)} points per 120 s run (arithmetic from ${Math.round(cand.share * 100)}% share × ${Math.round(cand.excessMs)} ms excess) — ${cand.est.note}`,
      evidence: [`column brings ${cand.count} solves at ${(cand.medianMs / 1000).toFixed(2)}s vs reference ${(cand.referenceMs / 1000).toFixed(2)}s`],
      launch: launchCell ? { type: 'drill', cell: launchCell, record: null } : { type: 'none' },
    });
  }

  if (!items.length) {
    const coverage = skillCoverage(sessions, { scope: 'all' });
    items.push({
      id: 'coverage:start',
      kind: 'coverage',
      title: 'Build the evidence first',
      why: coverage.observedCells
        ? `Patterns observed ${coverage.observedCells} of ${coverage.totalCells}, stable evidence ${coverage.stableCells}. No sample-gated weakness and no due reviews yet; keep running standard benchmarks and drills so selection has something reliable to read.`
        : 'No skill-pattern data yet — run a standard benchmark and a few heatmap drills; recommendations stay empty (honest default) until cells fill in.',
      evidence: [coverage.observedCells ? `coverage ${coverage.observedCells}/${coverage.totalCells} (describes reach, not ability)` : 'no observations yet'],
      launch: { type: 'none' },
    });
  }
  return { now: new Date(nowMs).toISOString(), items, skipped: { reviewsTotal: queue.total, reviewsSkipped: queue.skipped } };
}
