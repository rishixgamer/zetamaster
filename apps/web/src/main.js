import { BENCHMARK_RULES, customRules } from '../../../packages/core/src/rulesets.js';
import { createGenerator, makeQuestion } from '../../../packages/core/src/generator.js';
import { ArithmeticSession } from '../../../packages/core/src/session.js';
import { sessionStats, operationSummary } from '../../../packages/analytics/src/stats.js';
import { benchmarkProgress } from '../../../packages/analytics/src/progress.js';
import { diagnose } from '../../../packages/analytics/src/diagnostics.js';
import { errorTypology } from '../../../packages/analytics/src/errors.js';
import { consistencySummary } from '../../../packages/analytics/src/consistency.js';
import { paceProfile, tailProfile } from '../../../packages/analytics/src/fatigue.js';
import { relativeHistogram } from '../../../packages/analytics/src/histogram.js';
import { entryQuality, MIN_TYPE_SAMPLES } from '../../../packages/analytics/src/entry-quality.js';
import { buildHeatmap, slowestCells, MIN_CELL_SAMPLES } from '../../../packages/analytics/src/heatmap.js';
import { chooseAdaptive, operationDrill, sprintRules, enduranceRules, patternDrill, automaticityDrill, drillTierForRecord, DEFAULT_DRILL_TIER, DRILL_TIERS } from '../../../packages/training/src/drills.js';
import { intervalSet, intervalSetRationale } from '../../../packages/training/src/sets.js';
import { skillOf, skillCellFromId } from '../../../packages/training/src/skills.js';
import { drillReviewOutcome, drillReviewEligible, reviewQueue, SKILL_REVIEW_MIN_SOLVES, SKILL_REVIEW_FAST_MS } from '../../../packages/training/src/reviews.js';
import { gauntletPlan, gauntletLaunch, gauntletGenerator } from '../../../packages/training/src/gauntlet.js';
import { scoreChartSvg, forecastChartSvg, forecastChartLayout, chartLayout, nearestIndex, CHART } from './score-chart.js';
import { nextGridPosition, heatmapHash, parseHeatmapHash } from './grid-nav.js';
import { dailyPlan } from '../../../packages/training/src/planner.js';
import { buildRecommendations } from '../../../packages/training/src/recommendations.js';
import { comparePolicies } from '../../../packages/training/src/policies.js';
import { createPolicyTrial, serializeTrial, parseStoredTrial, trialOutcomes, summarizeTrialOutcomes, TRIAL_WINDOW_DAYS, TRIAL_CYCLE_WINDOWS, TRIAL_MIN_PAIRS_PER_ARM } from '../../../packages/training/src/trial.js';
import { sanitizeProvenance } from '../../../packages/training/src/provenance.js';
import { evaluateProgression, PROGRESSION_STAGES, getStageForScore, MIN_PROGRESSION_BENCHMARKS } from '../../../packages/training/src/progression.js';
import { selectPersonalBestBenchmark, buildGhostTrajectory, compareGhostPace } from '../../../packages/analytics/src/ghost.js';
import { generateCopyTrials, evaluateCopyTrial, computeHardwareDiagnostics } from '../../../packages/core/src/calibration.js';
import { forecastProgress, MIN_FORECAST_RUNS, DEFAULT_FORECAST_HORIZON } from '../../../packages/analytics/src/forecasting.js';
import { benchmarkSeries } from '../../../packages/analytics/src/consistency.js';
import { LESSONS } from '../../../packages/curriculum/src/lessons.js';
import { planForLesson, askPlan, transferPlan, checkGuideAnswer, guideDrillTarget, GUIDE_MODES, GUIDE_LESSON_IDS } from '../../../packages/curriculum/src/guides.js';
import { suggestLesson } from '../../../packages/curriculum/src/explanations.js';
import { listSessions, saveSession, deleteAllSessions, importSessions, importSkillReviews, listSkillReviews, recordSkillReview, listDailyPlans, saveDailyPlan, importDailyPlans, deleteAllDailyPlans } from '../../../packages/storage/src/db.js';
import { downloadJson, downloadCsv, exportBundle, parseExportBundle } from '../../../packages/storage/src/export.js';
import { reconcilePlan, togglePlanStep, completedMinutes, dayLogKey, planRecordFrom } from '../../../packages/training/src/daylog.js';
import { evaluateBenchmarkRank, evaluatePracticeActivity, COMMUNITY_RANKS, getRankForScore } from '../../../packages/community/src/ranks.js';
import { evaluateAchievements, ACHIEVEMENT_CATALOG } from '../../../packages/community/src/achievements.js';
import { encodeChallenge, decodeChallenge, buildChallengeUrl, parseChallengeFromUrl } from '../../../packages/community/src/challenges.js';
import { verifyBenchmarkSession } from '../../../packages/services/src/anti-cheat.js';
import { submitLeaderboardScore, getLeaderboardRankings, readLeaderboardConsent, setLeaderboardConsent, sanitizeAlias, defaultLeaderboardStore } from '../../../packages/services/src/leaderboard.js';
import { createQuantGenerator } from '../../../packages/quant/src/generator.js';
import { renderQuantUI } from './quant-ui.js';
import { renderReplayUI } from './replay-ui.js';
import { renderDuelUI } from './duel-ui.js';
import { renderCoachUI } from './coach-ui.js';
import { readEntrySettings, writeEntrySettings, readCustomRanges, writeCustomRanges, customRangesFromFields, DEFAULT_ENTRY_SETTINGS } from './entry-settings.js';
import { playCue } from './cues.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = value => Number.isFinite(value) ? (value/1000).toFixed(2)+'s' : '—';
const opNames={add:'Addition',sub:'Subtraction',mul:'Multiplication',div:'Division'};
const durationFormat = ms => { const seconds=Math.ceil(Math.max(0,ms)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; };
const getOps=()=>$$('#ops input:checked').map(x=>x.value);
let sessions=[];
let skillReviews=[];   // persisted per-skill spaced-repetition records (F19)
let dailyPlanRecords=[]; // persisted per-day plan completion (F34)
let lastPlanSteps=null; // reconciled steps of the currently rendered plan (completion writes re-serialize them)
let drillReview=null;  // the spaced-review outcome of the drill that just finished, for the results panel
let currentSession=null;
let tick=null;
const MAX_FIELD=24;
let currentMode='benchmark';
let currentReplay=null;
let currentDrill=null;
let currentProvenance=null;
let activeGhostTrajectory=null; // Personal-best ghost racing trajectory (F33)
let calibState={step:'intro',trials:[],index:0,trialStartedAt:0,results:[]}; // Hardware calibration (F40)
const heatmapState={op:'mul',scope:'benchmark',focus:{row:0,col:0},selected:null};
let currentSeed='';
let lastLaunch=null;  // the full launch vehicle (preset/replay/drill + provenance) as one snapshot, re-launched verbatim by "Play again"
let lastResult=null;
// Active speed-interval set (F30): practice pacing state only — never persisted, never scored.
// `done` counts finished work bouts; `restSinceMs` marks the last work bout's end on the monotonic
// clock for the informational recovery meter between the manual continue steps.
let sprintSet=null;
let setRestSinceMs=0;
let restTicker=null;
// Entry settings & feedback (F02/F05): toggles default OFF, device-local; the audio context is
// created lazily on the first user gesture so autoplay policies are satisfied.
let entrySettings={...DEFAULT_ENTRY_SETTINGS};
let audioContext=null;

async function refresh() {
  sessions=await listSessions();
  skillReviews=await listSkillReviews().catch(()=>[]);
  dailyPlanRecords=await listDailyPlans().catch(()=>[]);
  const p=benchmarkProgress(sessions);
  const prog=evaluateProgression(sessions);
  const values=[p.personalBest??'—',p.recentMedian??'—',p.count,prog.stage.name,'70+'];
  $$('#top-metrics .metric strong').forEach((el,i)=>el.textContent=values[i]);
  renderDailyPlan();
  renderLadderPanel(prog);
  renderAnalytics();
  renderReviewQueue();
  renderGauntlet();
  renderIntervals();
  renderRecommendations();
  renderCommunity();
  renderQuant();
}

// Daily plan (F34): steps regenerate from history every refresh; only *completion* persists (one
// record per local day in the dailyPlans store). Checkboxes bind to that record, so ticks survive
// reloads, and the budget is an exact-minutes split weighted toward the weakest operation/branch.
// Branch action codes map to plain-language next steps so the recommendation names what to do
// (F38) while staying honest that none of it is a measured treatment.
const PLAN_ACTION_LABELS={gauntlet:'weakness gauntlet','transfer-probe':'transfer probe','curriculum-lesson':'technique lesson','isolation-practice':'isolation practice','standard-benchmark':'standard benchmark',rest:'planned rest between runs'};
function interventionLine(intervention){
  return intervention?` · Suggested intervention: ${esc(intervention.name)} (a hypothesis to test, not a proven treatment) — next: ${intervention.actions.map(a=>esc(PLAN_ACTION_LABELS[a]??a)).join(' → ')}`:'';
}
function renderDailyPlan() {
  const plan=dailyPlan(sessions);
  const todayKey=dayLogKey(new Date());
  const record=dailyPlanRecords.find(x=>x?.id===todayKey) ?? null;
  const steps=reconcilePlan(plan.steps,record);
  lastPlanSteps=steps;
  const done=completedMinutes(steps);
  const coverageLine=plan.coverage.observedCells
    ?`patterns observed ${plan.coverage.observedCells} of ${plan.coverage.totalCells} · stable evidence ${plan.coverage.stableCells} (describes reach, not ability)`
    :'no skill-pattern data yet — the plan starts operation-level until cells fill in';
  $('#plan-rationale').textContent=plan.rationale;
  $('#plan-steps').innerHTML=steps.map((x,i)=>`<div class="step plan-step"><input type="checkbox" id="plan-step-${esc(x.id)}" data-plan-step="${esc(x.id)}" aria-label="${esc(`${x.title}, ${x.minutes} minutes`)}" ${x.completed?'checked':''}><label for="plan-step-${esc(x.id)}"><span class="step-num">${i+1}</span><span class="step-title">${esc(x.title)}</span></label><span class="step-time">${x.minutes} min</span></div>`).join('');
  const setPlanProgress=minutesDone=>{$('#plan-progress').innerHTML=`<p class="small muted">Today: ${minutesDone} / ${plan.targetMinutes} min logged · ${esc(coverageLine)}${interventionLine(plan.intervention)}</p>`;};
  setPlanProgress(done);
  $('#plan-steps').querySelectorAll('[data-plan-step]').forEach(box=>box.addEventListener('change',async()=>{
    const updated=togglePlanStep(lastPlanSteps,box.dataset.planStep,box.checked,new Date().toISOString());
    lastPlanSteps=updated;
    await saveDailyPlan(planRecordFrom(updated,{dateKey:todayKey,targetMinutes:plan.targetMinutes,updatedAt:new Date().toISOString()})).catch(()=>{});
    setPlanProgress(completedMinutes(updated));
  }));
}

// Skill Progression Ladder (F35, M3 close-out): explicit 30→40→50→60→70+ milestone tiers
function renderLadderPanel(prog) {
  const root = $('#ladder-panel'); if (!root) return;
  const p = prog ?? evaluateProgression(sessions);
  const isBaseline = p.status === 'establishing-baseline';
  const currentStage = p.stage;
  const nextStage = p.nextStage;

  const trackHtml = PROGRESSION_STAGES.map(s => {
    const isCurrent = s.id === currentStage.id;
    const isDone = s.level < currentStage.level;
    const cls = isCurrent ? ' active' : (isDone ? ' completed' : '');
    return `<div class="ladder-step${cls}">
      <span class="ladder-step-num">STAGE ${s.level} · ${isDone ? '✓ ' : ''}${esc(s.name.toUpperCase())}</span>
      <span class="ladder-step-title">${s.targetScore >= 70 ? '70+ Target' : `${s.minScore}–${s.targetScore} pts`}</span>
      <span class="ladder-step-range">${esc(s.focus)}</span>
    </div>`;
  }).join('');

  const progressTitle = isBaseline
    ? `Establishing benchmark baseline: ${p.benchmarkCount} of ${p.minRunsNeeded} standard runs recorded (${p.runsRemaining} more needed)`
    : `${currentStage.name} tier (level ${currentStage.level}/5): rolling median ${p.medianScore.toFixed(1)} · ${p.progressPct}% complete within stage${nextStage ? ` (${p.pointsToNext.toFixed(1)} pts to ${nextStage.name})` : ''}`;

  const barPct = isBaseline
    ? Math.round((p.benchmarkCount / p.minRunsNeeded) * 100)
    : p.progressPct;

  const masteryStatus = p.mastery70Met
    ? '<strong>8-of-10 consistency goal met!</strong> Full 70+ mastery unlocked.'
    : (p.stage.id === 'mastery'
      ? `Mastery tier active: ${p.consistency?.hits ?? 0} of ${p.consistency?.windowRuns ?? 0} recent standard runs at 70+ (needs 8 of 10).`
      : '');

  root.innerHTML = `<div class="section-header">
    <div>
      <div class="eyebrow">SKILL PROGRESSION LADDER · F35</div>
      <h2 class="section-title">Progression tier: ${esc(currentStage.name)}</h2>
    </div>
    <span class="tag">${isBaseline ? `${p.runsRemaining} RUNS TO BASELINE` : `TIER ${currentStage.level} OF 5`}</span>
  </div>
  <div class="ladder-track">${trackHtml}</div>
  <div class="ladder-bar"><div style="width:${barPct}%"></div></div>
  <p class="secondary">${esc(progressTitle)}</p>
  ${masteryStatus ? `<p class="secondary">${masteryStatus}</p>` : ''}
  <div class="ladder-card" style="margin-top:12px">
    <div class="ladder-card-head">
      <span class="ladder-card-title">Stage focus: ${esc(currentStage.focus)}</span>
      <span class="ladder-badge active">${esc(currentStage.name)} Focus</span>
    </div>
    <p class="secondary" style="margin:4px 0">${esc(currentStage.description)}</p>
    <p class="small muted">Key training focuses: ${esc(currentStage.recommendedActions.join(' · '))}</p>
  </div>
  <p class="small muted" style="margin-top:10px">Evaluated strictly from verified standard 120-second benchmarks (gated at >= 3 runs). Practice, drills, and unverified runs never alter ladder standing.</p>`;
}

// Weakness gauntlet (F32): select weakest gated cells → tier-aware drill per cell → same-family
// transfer probe on a fresh day-scoped seed → hand-off to one standard benchmark. The plan is pure
// data from packages/training/src/gauntlet.js; this panel only renders it and launches stages.
function renderGauntlet(){
  const root=$('#gauntlet-panel'); if(!root)return;
  let plan=null, planError=null;
  try{plan=gauntletPlan(sessions,{reviews:skillReviews,now:new Date()});}
  catch(error){planError=error.message;}
  const rows=plan?.cells?.map(c=>`<div class="review-row"><span class="review-label">${esc(c.label)}</span><span class="review-meta">×${c.ratio.toFixed(2)} vs ${opNames[c.op]} median · ${c.count} solves · ${esc(c.evidence)} · next set ${esc(DRILL_TIERS[c.tier])}</span><span class="gauntlet-actions"><button type="button" class="secondary-btn" data-gauntlet-launch="${esc(c.cell)}" data-gauntlet-stage="train">Drill ${c.train.seconds}s <span aria-hidden="true">↗</span></button><button type="button" class="secondary-btn" data-gauntlet-launch="${esc(c.cell)}" data-gauntlet-stage="probe">Probe ${c.probe.seconds}s <span aria-hidden="true">↗</span></button></span></div>`).join('');
  root.innerHTML=`<div class="section-header"><div><div class="eyebrow">WEAKNESS GAUNTLET · TRAIN → PROBE → BENCHMARK</div><h2 class="section-title">Weakness gauntlet</h2></div><span class="tag">${plan?.cells?.length??0} TARGET${plan?.cells?.length===1?'':'S'}</span></div>
    ${planError?`<p class="secondary">Plan unavailable: ${esc(planError)}</p>`:rows?`<p class="secondary">Today's quota drills your slowest reliably-observed patterns, then probes each family with fresh problems from an independent seed — unseen draws, same range — so you can tell whether the practice held. Finish with one standard 120-second benchmark to measure transfer on real mixed pace.</p>
    <div class="review-list">${rows}</div>
    <div class="subline"><button type="button" class="primary-btn" id="gauntlet-benchmark">Finish with standard benchmark ↗</button></div>`:`<div class="empty">${esc(plan?.emptyNote??'No gauntlet data yet.')}</div>`}
    <p class="small muted">Quota: at most two categories per gauntlet day (the shrunken ratio decides order, ≥3 solves to qualify). The probe day-scopes its seed — the same day replays the probe, a new day draws a fresh one. Everything here is practice: probes and drills never enter benchmark scores, and probes never write spaced reviews. No evidence yet that gauntlet training lifts benchmark scores (F21/F22 evaluate transfer).</p>`;
  root.querySelectorAll('[data-gauntlet-launch]').forEach(btn=>btn.addEventListener('click',()=>{
    const cellId=btn.dataset.gauntletLaunch, stage=btn.dataset.gauntletStage;
    try {
      const launch=gauntletLaunch(plan,cellId,stage);
      // F20/F21 provenance: the gauntlet is the training method being evaluated — drills, probes
      // and the finish-with-standard-benchmark handoff all record this surface.
      startGame({preset:{mode:launch.mode,rules:launch.rules,seed:launch.seed,varied:launch.varied,drill:launch.drill},provenance:{surface:'gauntlet',stage,cellId}});
    } catch(error){alert(error.message);}
  }));
  $('#gauntlet-benchmark')?.addEventListener('click',()=>{
    $('#mode').value='benchmark';updateMode();
    // The standard run that closes a gauntlet day is the measurement arm: provenance links it to
    // the treatment bursts that came before it (metadata only — validity is unaffected).
    startGame({provenance:{surface:'gauntlet',stage:'benchmark'}});
  });
}
// Speed-interval sets (F30 close-out): several short work bouts — each an independent 'sprint'
// practice run — separated by recovery pauses the user continues by hand. The rest meter is
// informational, runs on the monotonic clock, pauses nothing and gates nothing; benchmarks are
// untouched by construction (sprint rules can never validate as the benchmark). Every note here is
// honest that the recovery hypothesis is untested; only the measured half-slowdown is evidence.
const INTERVAL_SPEC = () => intervalSet();
function stopRestTicker() { if (restTicker) { clearInterval(restTicker); restTicker = null; } }
function startRestTicker(spec) {
  if (restTicker) return;
  restTicker = setInterval(() => {
    if (!sprintSet) { stopRestTicker(); return; }
    const meter = $('#rest-meter');
    if (meter) meter.textContent = restMeterText(spec, performance.now());
  }, 250);
}
function restMeterText(spec, nowMs) {
  const elapsedMs = Math.max(0, nowMs - setRestSinceMs);
  const needMs = spec.restSeconds * 1000;
  if (elapsedMs >= needMs) return `recovered — rested ${Math.round(elapsedMs / 1000)} s, target was ${spec.restSeconds} s`;
  return `${Math.ceil((needMs - elapsedMs) / 1000)} s of recovery left (rested ${Math.floor(elapsedMs / 1000)} s of ${spec.restSeconds} s)`;
}
function launchSetStage(spec, index) {
  // Each work bout is its own practice session; the preset keeps "Play again" relaunching the
  // same bout. The `interval-set` payload marks the result so the set advances on finish.
  startGame({ preset: { mode: 'sprint', rules: sprintRules(spec.workSeconds), drill: { stage: 'interval-set', index } } });
}
function renderIntervals() {
  const root = $('#intervals-panel'); if (!root) return;
  const spec = INTERVAL_SPEC();
  const rationale = intervalSetRationale(paceProfile(sessions));
  const evidence = rationale
    ? `Evidence link: ${esc(rationale.text)} — that slowdown is measured; running short bouts with recovery is a hypothesis about how to counter it, untested here.`
    : `No verified split data yet (needs 3 standard benchmarks with solves in both halves): as structured practice this is a hypothesis without local evidence either way.`;
  let body;
  if (!sprintSet) {
    stopRestTicker();
    body = `<p class="secondary">${esc(spec.label)}: each sprint is a separate, always-practice run; between sprints you rest by hand and start the next one when ready. The recovery meter counts up from your last sprint using the monotonic clock — it pauses no timer and affects no benchmark. The set itself is not saved; only its sprint runs are (like all practice).</p>
      <div class="subline"><button type="button" class="primary-btn" id="intervals-run">Run the set · ${esc(spec.label)} ↗</button></div>
      <p class="small muted">${evidence}</p>`;
  } else if (sprintSet.done >= spec.workStages) {
    stopRestTicker();
    body = `<p class="secondary">Set complete: ${spec.workStages} sprints finished. The pacing note isn't stored anywhere — the sprint runs themselves are in practice history.</p>
      <div class="subline"><button type="button" class="primary-btn" id="intervals-run">Run another set ↗</button></div>
      <p class="small muted">${evidence}</p>`;
  } else {
    startRestTicker(spec);
    body = `<p class="secondary">Sprint ${sprintSet.done} of ${spec.workStages} done. <span id="rest-meter" role="timer" aria-live="polite">${esc(restMeterText(spec, performance.now()))}</span> Continue with sprint ${sprintSet.done + 1} whenever you feel ready — resting by hand is the point, and skipping the rest is a choice, not an error.</p>
      <div class="subline"><button type="button" class="primary-btn" id="intervals-next">Sprint ${sprintSet.done + 1} of ${spec.workStages} ↗</button> <button type="button" class="secondary-btn" id="intervals-end">End set</button></div>
      <p class="small muted">${evidence}</p>`;
  }
  root.innerHTML = `<div class="section-header"><div><div class="eyebrow">SPEED INTERVALS · SETS + RECOVERY · PRACTICE</div><h2 class="section-title">Interval set</h2></div><span class="tag">${esc(spec.label)}</span></div>${body}`;
  $('#intervals-run')?.addEventListener('click', () => { sprintSet = { done: 0 }; setRestSinceMs = 0; launchSetStage(spec, 1); });
  $('#intervals-next')?.addEventListener('click', () => launchSetStage(spec, sprintSet ? sprintSet.done + 1 : 1));
  $('#intervals-end')?.addEventListener('click', () => {
    sprintSet = null; setRestSinceMs = 0;
    stopRestTicker();
    renderIntervals(); refresh();
  });
}
// Due pattern reviews (F19): the queue reads persisted nextReviewAt records and launches a
// cell-limited pattern drill. Due = next review at or before now. Records only appear after drill
// runs or imports, so a new account sees an honest empty state, not fabricated homework.
function reviewRow(item,dueText,launch){
  const tier=drillTierForRecord(item.record);
  return `<div class="review-row"><span class="review-label">${esc(item.label)}</span><span class="review-meta">${esc(dueText)} · next set ${esc(DRILL_TIERS[tier])}</span>${launch?`<button type="button" class="secondary-btn" data-review-launch="${esc(item.id)}" data-review-tier="${tier}">Practice 60s <span aria-hidden="true">↗</span></button>`:''}</div>`;
}
function renderReviewQueue(){
  const root=$('#review-panel'); if(!root)return;
  const now=Date.now();
  const q=reviewQueue(skillReviews,now);
  const dueAt=nextMs=>`due now · ${Math.max(1,Math.round((now-nextMs)/86400000))} day(s) overdue`;
  const rows=q.due.map(item=>reviewRow(item,`${dueAt(item.nextMs)} · streak ${item.record.successes} · lapses ${item.record.failures} · every ${item.record.intervalDays} d`,true)).join('');
  const upcoming=q.upcoming.length?`<h3 class="subhead">Next up</h3>${q.upcoming.map(item=>reviewRow(item,`in ${Math.max(1,Math.ceil((item.nextMs-now)/86400000))} d · every ${item.record.intervalDays} d`,false)).join('')}`:'';
  root.innerHTML=`<div class="section-header"><div><div class="eyebrow">SPACED REVIEW · PATTERN DRILLS ONLY</div><h2 class="section-title">Due pattern reviews</h2></div><span class="tag">${q.due.length} DUE</span></div>
    ${skillReviews.length?'':`<p class="secondary">No review records yet. A finished 60-second pattern drill (from a heatmap cell or the slowest-pattern hint in your plan) records one per cell; the next repetition is then spaced 1, 2, 4 … up to 60 days apart, and difficulty follows the streaks (a lapse narrows the drill, four consecutive fast runs stretch it).</p>`}
    ${rows?`<div class="review-list"><p class="secondary">These patterns are due for review: fast completion spaces them out; a slower run brings them back tomorrow.</p>${rows}</div>`:skillReviews.length?`<div class="empty">Nothing due right now. Reviews land 1, 2, 4 … 60 days after each drill.</div>`:''}
    ${upcoming}
    <p class="small muted">A review records speed and accuracy: success needs at least ${SKILL_REVIEW_MIN_SOLVES} finished problems, at least half of them at or under the ${fmt(SKILL_REVIEW_FAST_MS)} line, and at least half of them without a wrong answer typed or Enter-submitted first. Solves without a recorded wrong-attempt history (engine-1 era sessions) count as accuracy-unknown and lean clean — absence of the field is never read as evidence of errors. Interrupted runs record nothing. The 1–60 day spacing ladder is a heuristic, not a validated model. Definitions: docs/SKILLS.md.</p>`;
  root.querySelectorAll('[data-review-launch]').forEach(btn=>btn.addEventListener('click',()=>{
    const cell=skillCellFromId(btn.dataset.reviewLaunch);
    const tier=Number(btn.dataset.reviewTier);
    if(cell)startGame({drill:{...cell,tier:Number.isInteger(tier)?tier:undefined},provenance:{surface:'review-queue',cellId:cell.id??cell.label,stage:'review'}});
  }));
}
// Merged, evidence-linked recommendations (F38) plus the seeded policy-comparison card (F21). The
// list is pure data from packages/training/src/recommendations.js; buttons reuse the drill launch
// path so every recommendation lands in an actual practice run, never a claim.
function deviceSeed() {
  try {
    const existing = localStorage.getItem('zetamaster-device-seed');
    if (existing) return existing;
    const seed = crypto.randomUUID();
    localStorage.setItem('zetamaster-device-seed', seed);
    return seed;
  } catch { return crypto.randomUUID(); }
}
const TRIAL_STORAGE_KEY='zetamaster-policy-trial';
// Randomized crossover policy trial card (F21/M4-F37 close-out): strictly opt-in. Joining makes
// the Train panel's emphasis follow the seeded A/B window cycle — two treatment windows then a
// holdout window — and leans on the provenance tagging that already exists; scoring, timing and
// benchmark validity are untouched, and leaving reverts to the seeded assignment. The outcome
// ledger below the card is the one-learner crossover reading with its full caveat list.
function trialCardHtml(policy, trial, ledgerText) {
  if (!trial) {
    return `<div class="review-row"><span class="review-label">Randomized policy trial — not joined</span><span class="review-meta">Opt-in crossover: 3-day windows emphasize one of two policies (seeded order), every third window is a holdout with emphasis off; leave anytime. Practice-only — never touches benchmark scoring or validity.</span><button type="button" class="secondary-btn" data-trial-join>Join the trial</button></div>`;
  }
  const info=policy?.trial;
  const drives=info?(info.phase==='holdout'
    ?`holdout window ${info.windowIndex} (${info.startsAt.slice(0,10)} → ${info.endsAt.slice(0,10)}): emphasis OFF, drills from this panel launch unattributed`
    :`window ${info.windowIndex} emphasizes ${info.policyId} until ${info.endsAt.slice(0,10)} (order: ${info.order}; next holdout from ${info.nextHoldout.startsAt.slice(0,10)})`):'window state unavailable right now';
  return `<div class="review-row"><span class="review-label">Randomized policy trial · joined</span><span class="review-meta">${esc(drives)}</span><button type="button" class="secondary-btn" data-trial-leave>Leave trial</button></div>
    <div class="subline">${esc(ledgerText ?? 'No attributed trial windows yet.')}</div>`;
}
function trialLedgerText(trial) {
  if (!trial) return null;
  try {
    const summary=summarizeTrialOutcomes(trialOutcomes(sessions,trial),{trial});
    if (!summary.policyOutcomes.length) return `No attributed trial windows yet (gate: ≥${TRIAL_MIN_PAIRS_PER_ARM} windows per policy).`;
    const rows=summary.policyOutcomes.map(r=>`${r.policyId}: ${r.attributedWindows} window(s), median Δ ${r.medianDelta===null?'—':(r.medianDelta>0?'+':'')+r.medianDelta}, improving ${r.improvingShare.improving}/${r.improvingShare.windows} (95% ${Math.round(r.improvingShare.low*100)}–${Math.round(r.improvingShare.high*100)}%)`).join(' · ');
    return `${rows} — ${summary.note} Caveats: ${summary.caveats.join(' ')}`;
  } catch (error) {
    return `Trial ledger unavailable: ${error.message}`;
  }
}
function renderRecommendations() {
  const root=$('#recs-panel'); if(!root)return;
  let items=[], policy=null, trial=null, trialStored=null, error=null;
  try {
    trialStored=localStorage.getItem(TRIAL_STORAGE_KEY);
    trial=parseStoredTrial(trialStored);
    const recs=buildRecommendations({sessions,reviews:skillReviews,now:new Date().toISOString()});
    items=recs.items;
    policy=comparePolicies(sessions,{seed:deviceSeed(),flag:localStorage.getItem('zetamaster-policy'),trial,nowMs:Date.now()});
  } catch(e){error=e.message;}
  const kindLabels={review:'review', 'weak-cell': 'pattern', plateau:'protocol', impact:'estimate', coverage:'start'};
  const rows=items.length?items.map(item=>{
    const launchBtn=item.launch.type==='drill'
      ?`<button type="button" class="secondary-btn" data-rec-drill="${esc(item.launch.cell.id??item.launch.cell.label)}">Drill 60s <span aria-hidden="true">↗</span></button>`
      : (item.launch.type==='panel'?'<a class="review-meta" href="#gauntlet-panel">gauntlet panel ↓</a>':'');
    return `<div class="review-row"><span class="review-label">${esc(item.title)}</span><span class="review-meta">${esc(item.why)}${item.evidence?.length?` · ${esc(item.evidence.join(' · '))}`:''}</span>${launchBtn}</div>`;
  }).join(''):`<div class="empty">No recommendations yet — run a benchmark to start the evidence.</div>`;
  root.innerHTML=`<div class="section-header"><div><div class="eyebrow">PROGRESS-BASED RECOMMENDATIONS · MERGED</div><h2 class="section-title">What's worth doing next</h2></div><span class="tag">${items.length} LEAD${items.length===1?'':'S'}</span></div>
    ${error?`<p class="secondary">Recommendations unavailable: ${esc(error)}</p>`:`<div class="review-list">${rows}</div>${trialCardHtml(policy,trial,trialLedgerText(trial))}
    <div class="subline" id="policy-compare">${esc(policy?.note??'Policy comparison unavailable.')}</div>`}
    <p class="small muted">Recommendations merge due pattern reviews, the weakest sample-gated patterns, the plateau protocol and one estimated-payoff line (reads your verified benchmark pace and medians). Estimates are arithmetic on your own history, not predictions of what training will achieve. The policy line only chooses which surface to emphasize: by default the seeded assignment, or the joined randomized crossover trial's current window (flag override still wins; ${esc(String(TRIAL_WINDOW_DAYS))}-day treated windows, every ${esc(String(TRIAL_CYCLE_WINDOWS))}rd window a holdout). Practice runs record the launch context (surface · emphasized policy · cell) as provenance (F20/F21); inside a treatment window recommendation drills recruit the emphasized policy exactly, and the trial ledger persists that pairing with its caveats — a one-learner crossover, never a claim that a policy is better (${esc(policy?.assignment ?? '')}).</p>`;
  const persistTrial=value=>{try{if(value===null)localStorage.removeItem(TRIAL_STORAGE_KEY);else localStorage.setItem(TRIAL_STORAGE_KEY,value);}catch{}renderRecommendations();};
  root.querySelector('[data-trial-join]')?.addEventListener('click',()=>{
    persistTrial(serializeTrial(createPolicyTrial({seed:deviceSeed(),startedAt:new Date().toISOString()})));
  });
  root.querySelector('[data-trial-leave]')?.addEventListener('click',()=>persistTrial(null));
  root.querySelectorAll('[data-rec-drill]').forEach(btn=>btn.addEventListener('click',()=>{
    const item=items.find(x=>x.launch.type==='drill'&&((x.launch.cell.id??x.launch.cell.label)===btn.dataset.recDrill||x.launch.cell.label===btn.dataset.recDrill));
    if(!item)return;
    const cell=skillCellFromId(item.launch.cell.id)??item.launch.cell;
    // F21: record the emphasized-policy context so treatment runs are attributable later. During a
    // trial holdout window the emphasis is null, so recommendation drills launch unattributed —
    // the honest contrast the trial's ledger counts separately.
    startGame({drill:{...cell,tier:drillTierForRecord(item.launch.record)},provenance:{surface:'recommendations',cellId:cell.id??cell.label,policyId:policy?.emphasizedPolicyId??null}});
  }));
}
function setView(view) {  $$('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+view));
  $$('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  window.scrollTo({top:0,behavior:'auto'});
}
function updateMode() {
  const mode=$('#mode').value;
  const hints={
    benchmark:'Strict 120-second benchmark. All operations, standard ranges, no skips or pausing. Ending early invalidates the benchmark.',
    adaptive:'Weights weaker operations more heavily, using response times from your history. Not a standardized score.',
    custom:'Choose one or more operations, a time limit and operand ranges (see the ranges panel below). Custom scores are separate from the benchmark.',
    isolation:'Practices the first checked operation only. Choose exactly one for clarity.',
    sprint:'30-second mixed-operation sprint. Practice score only.',
    endurance:'300-second mixed-operation endurance session. Practice score only.',
  };
  $('#mode-hint').textContent=hints[mode];
  $('#duration').disabled=['benchmark','sprint','endurance'].includes(mode);
  $('#duration').value={benchmark:'120',sprint:'30',endurance:'300'}[mode]||$('#duration').value;
  $$('#ops input').forEach(x=>x.disabled=!['custom','isolation'].includes(mode));
  // Custom operand ranges (F02): the four inverse-generation axes are editable in custom mode only.
  const ranges=$('#custom-ranges');
  if(ranges){ranges.classList.toggle('hidden',mode!=='custom');ranges.open=mode==='custom';}
}
function startGame({ replay=null, drill=null, preset=null, provenance=null }={}) {
  if(currentSession?.state==='active')return;
  // A preset is a fully built launch (rules + seed + drill payload) from a training module — the
  // gauntlet panel. The mode picker path is unchanged; presets phase in without touching it.
  const mode=preset?.mode ?? (drill?'drill':replay?'replay':$('#mode').value);
  let rules, weights=null, generator=null;
  const seconds=Number($('#duration').value);
  const selected=getOps();
  try {
    if(preset){rules=preset.rules;drill={...preset.drill};weights=null;}
    else if(mode==='benchmark')rules=BENCHMARK_RULES;
    else if(mode==='adaptive') {const selection=chooseAdaptive(sessions,seconds);rules=selection.rules;weights=selection.weights;}
    else if(mode==='custom')rules=customRulesWithRanges(seconds,selected);
    else if(mode==='isolation')rules=operationDrill(selected[0],seconds);
    else if(mode==='sprint')rules=sprintRules(30);
    else if(mode==='endurance')rules=enduranceRules(300);
    else if(mode==='replay')rules=customRules({durationSeconds:120});
    // Drill launches come in as skill cells; the tier (F18) rides along when the launch comes from
    // the review queue and defaults to the full pattern (2) on heatmap/hand-built launches. The
    // 'flash' stage (F31) runs the automaticity drill; gauntlet probes (F32) always arrive via the
    // preset path below and are never rebuilt here.
    else if(mode==='drill')rules=drill.stage==='flash'?automaticityDrill(drill,60):patternDrill(drill,60,{tier:drill.tier});
  } catch(error){alert(error.message);return;}
  currentSeed=(preset?.seed ?? $('#seed').value.trim()) || crypto.randomUUID();
  if(preset?.seed)$('#seed').value=preset.seed; // probes are reproducible for their day; show that
  if(replay) {
    let index=0;
    const items=replay.map(q=>makeQuestion(q.op,q.sourceLeft,q.sourceRight,++index));
    let cursor=0;
    generator=()=>{const q=items[cursor%items.length];cursor++;return {...q,id:`replay-${cursor}`,sequence:cursor};};
  } else if(preset?.generator) generator=preset.generator;
  else if(preset && preset.cells) generator=gauntletGenerator(preset,currentSeed);
  else if(mode==='quant'||preset?.mode==='quant') generator=preset?.generator ?? createQuantGenerator(currentSeed);
  else generator=createGenerator(rules,currentSeed,weights);
  currentMode=mode; currentReplay=replay; currentDrill=drill;
  // Run provenance (F20/F21): which surface/emphasized policy produced this practice run. Metadata
  // only — sanitized and dropped when malformed, never allowed to block or alter the launch.
  currentProvenance=sanitizeProvenance(provenance);
  // Snapshot the launch vehicle as one unit: "Play again" must not compose a stale preset (set by
  // an earlier panel launch) with the provenance of the run that just finished — that composition
  // mislabeled gauntlet-hand-off benchmarks and stale presets.
  lastLaunch={preset,replay,drill,provenance:currentProvenance};
  // Ghost racing (F33): enable cumulative pace comparison during replay and practice against personal-best benchmark
  const isPracticeOrReplay=Boolean(replay || drill || preset || mode!=='benchmark');
  if(isPracticeOrReplay){
    const pbSession=selectPersonalBestBenchmark(sessions);
    activeGhostTrajectory=pbSession?buildGhostTrajectory(pbSession):null;
  } else {
    activeGhostTrajectory=null;
  }
  currentSession=new ArithmeticSession({rules,generator,mode,seed:currentSeed,drill:drill?{op:drill.op,cell:drill.cell??drill.id??drill.key,label:drill.label,tier:drill.tier??DEFAULT_DRILL_TIER,stage:drill.stage}:null,provenance:currentProvenance});
  currentSession.start();
  $('#idle-layout').classList.add('hidden');$('#top-metrics').classList.add('hidden');$('#results').classList.add('hidden');$('#game').classList.remove('hidden');
  $('#game-mode').textContent=mode==='benchmark'?'STANDARD BENCHMARK':mode==='drill'?(drill?.stage==='probe'?`TRANSFER PROBE · ${rules.label} · PRACTICE`:drill?.stage==='flash'?`FLASH · ${rules.label} · PRACTICE`:`DRILL · ${rules.label} · PRACTICE`):`${mode.toUpperCase()} PRACTICE`;
  $('#game-score').innerHTML='0 <small>correct</small>';
  $('#answer').value='';
  syncKeypad();
  renderGhostPace();
  updateQuestion(); renderTick(); clearInterval(tick); tick=setInterval(renderTick,60);
  $('#answer').focus();
}
/**
 * Custom operand ranges (F02, M1 close-out). Reads the four setup axes (blank pair → that axis's
 * standard range), persists them device-locally for the next visit, and builds the practice-only
 * custom ruleset. Validation errors surface through the existing `catch` as `alert(error.message)`.
 */
function customRulesWithRanges(seconds,selected) {
  const ranges=customRangesFromFields({
    addLeftLo:$('#add-left-min')?.value, addLeftHi:$('#add-left-max')?.value,
    addRightLo:$('#add-right-min')?.value, addRightHi:$('#add-right-max')?.value,
    mulLeftLo:$('#mul-left-min')?.value, mulLeftHi:$('#mul-left-max')?.value,
    mulRightLo:$('#mul-right-min')?.value, mulRightHi:$('#mul-right-max')?.value,
  });
  writeCustomRanges(localStorage,ranges);
  return customRules({durationSeconds:seconds,enabled:selected,addition:ranges.addition,multiplication:ranges.multiplication});
}
/** Prefill the range fields with the last-used custom ranges at load; hidden until custom mode. */
function prefillCustomRanges(store=localStorage) {
  const stored=readCustomRanges(store);
  if(!stored)return;
  const fields=[['add-left-min',stored.addition.left[0]],['add-left-max',stored.addition.left[1]],['add-right-min',stored.addition.right[0]],['add-right-max',stored.addition.right[1]],['mul-left-min',stored.multiplication.left[0]],['mul-left-max',stored.multiplication.left[1]],['mul-right-min',stored.multiplication.right[0]],['mul-right-max',stored.multiplication.right[1]]];
  for(const [id,value] of fields){const input=document.getElementById(id);if(input)input.value=String(value);}
}
function renderGhostPace(remainingMs) {
  const ghostEl=$('#ghost-pace');
  if(!activeGhostTrajectory || currentSession?.state!=='active') {
    if(ghostEl)ghostEl.classList.add('hidden');
    return;
  }
  if(ghostEl)ghostEl.classList.remove('hidden');
  const durationMs=currentSession.rules.durationSeconds*1000;
  const rem=remainingMs ?? (currentSession?currentSession.remainingMs():durationMs);
  const elapsedMs=Math.max(0,durationMs-rem);
  const pace=compareGhostPace(currentSession.score,elapsedMs,activeGhostTrajectory);
  if(!pace)return;
  const badge=$('#ghost-badge'), stats=$('#ghost-stats'), delta=$('#ghost-delta');
  if(badge)badge.textContent=`👻 PB GHOST (${activeGhostTrajectory.finalScore})`;
  if(stats)stats.textContent=`Ghost: ${pace.ghostScore} · Live: ${pace.currentScore} · Proj: ${pace.projectedFinal}`;
  if(delta){
    const sign=pace.delta>0?'+':'';
    delta.textContent=pace.status==='tied'?'±0 tied':`${sign}${pace.delta} ${pace.status}`;
    delta.className=`ghost-delta ghost-${pace.status}`;
  }
}
function updateQuestion() {
  const q=currentSession.current;
  $('#problem').textContent=q.expression ?? `${q.left} ${q.symbol} ${q.right}`;
  $('#game-score').innerHTML=`${currentSession.score} <small>correct</small>`;
  renderGhostPace();
}
function renderTick() {
  if(currentSession?.state!=='active')return;
  const ms=currentSession.tick();
  // A flash drill (F31) expires slow questions: clear the stale answer and show the next problem.
  if(currentSession.consumeExpiry()){$('#answer').value='';updateQuestion();}
  $('#timer').textContent=durationFormat(ms);
  $('#time-fill').style.width=(100*ms/(currentSession.rules.durationSeconds*1000)).toFixed(2)+'%';
  renderGhostPace(ms);
  if(currentSession.state==='finished')finishGame(false);
}
/** Lazily create the audio context on a user gesture; null when unavailable or unwanted. */
function soundContext() {
  if(!entrySettings.sound)return null;
  try {
    if(!audioContext)audioContext=new (globalThis.AudioContext??globalThis.webkitAudioContext)();
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
    return audioContext;
  } catch { return null; }
}
function soundCue(name){playCue(soundContext(),name,entrySettings.sound);}
/**
 * One shared entry path for every answer feed (keyboard, keypad, replay of gestures): trim to the
 * field cap, hand the full text to the session, clear on solve. The keypad (F05) uses exactly
 * this path, so telemetry, timings and the answer rule are identical to typed input.
 */
function feedAnswer(value) {
  if(currentSession?.state!=='active')return false;
  const input=$('#answer');
  if(String(value).length>MAX_FIELD)value=String(value).slice(0,MAX_FIELD);
  input.value=value;
  const solved=currentSession.recordInput(value);
  if(currentSession.state==='finished'){finishGame(false);return true;}
  if(solved){input.value='';updateQuestion();soundCue('correct');}
  return solved;
}
function answerInput(event) {
  feedAnswer(event.currentTarget.value);
}
// On-screen keypad (F05, M1 close-out): the same buttons on every device. `pointerdown`
// preventDefault keeps keyboard focus in the answer field (so typing never skips); the buttons
// remain real `<button>`s and tabbable, and Enter mirrors the physical Enter semantics (a wrong
// submission record, exactly like the original game — no game effect).
const KEYPAD_KEYS=['1','2','3','4','5','6','7','8','9','0','backspace','enter'];
const KEYPAD_LABELS={backspace:'⌫ Delete',enter:'↵ Enter'};
function renderKeypad() {
  const pad=$('#keypad'); if(!pad)return;
  pad.innerHTML=KEYPAD_KEYS.map(key=>`<button type="button" class="keypad-key${key==='enter'?' keypad-enter':''}" data-key="${key}" aria-label="${esc(KEYPAD_LABELS[key]??`digit ${key}`)}">${esc(KEYPAD_LABELS[key]??key)}</button>`).join('');
  pad.querySelectorAll('.keypad-key').forEach(btn=>{
    btn.addEventListener('pointerdown',e=>e.preventDefault()); // keep the answer field focused
    btn.addEventListener('click',()=>padPress(btn.dataset.key));
  });
  syncKeypad();
}
function padPress(key) {
  if(currentSession?.state!=='active')return;
  if(key==='backspace')feedAnswer($('#answer').value.slice(0,-1));
  else if(key==='enter')currentSession.markWrongSubmission();
  else feedAnswer($('#answer').value+key);
}
function syncKeypad() {
  const pad=$('#keypad'); if(!pad)return;
  pad.classList.toggle('hidden',!(entrySettings.keypad&&currentSession?.state==='active'));
}
async function finishGame(endedEarly) {
  if(!currentSession || currentSession.state==='ready')return;
  clearInterval(tick);tick=null;
  // The core marks manual or short runs as ineligible; the UI never upgrades a result to benchmark.
  const result=currentSession.finish({endedEarly});
  if(!result || lastResult===result)return;
  lastResult=result;
  // One review per finished drill run (F19): outcome from the run's own finish time, so the record
  // is reproducible from stored data. Practice/benchmark namespaces stay separate — benchmarks and
  // plain practice runs never touch the review store; drill runs are practice-scope by definition.
  drillReview=await recordDrillReview(result);
  // A finished interval-set work bout advances the practice set (F30): manual early ends don't
  // count — only full-length sprint runs do. Rest meter start = the monotonic now, never Date.now.
  if (sprintSet && result.drill?.stage === 'interval-set' && Number.isSafeInteger(result.drill.index) && result.endedEarly !== true) {
    sprintSet.done = Math.max(sprintSet.done, result.drill.index);
    setRestSinceMs = performance.now();
  }
  await saveSession(result);
  $('#game').classList.add('hidden');$('#results').classList.remove('hidden');
  $('#result-title').textContent=result.benchmark?'Standard benchmark completed':`${result.mode} session completed`;
  $('#result-score').textContent=result.score;
  syncKeypad();
  soundCue('finish');
  const stats=sessionStats(result);
  const typology=errorTypology(result.events);
  const hidden=result.integrity?.hiddenMs>0?` · tab hidden ${fmt(result.integrity.hiddenMs)} (clock kept running)`:'';
  let ghostLine='';
  if(activeGhostTrajectory){
    const ghostFinal=activeGhostTrajectory.finalScore;
    const diff=result.score-ghostFinal;
    const diffText=diff>0?`+${diff} ahead of PB`:diff<0?`${diff} behind PB`:'tied with PB';
    ghostLine=`<p class="secondary ghost-finish">👻 Ghost pace comparison: finished at ${result.score} vs Personal Best ${ghostFinal} (${diffText}). Zero benchmark contamination.</p>`;
  }
  $('#result-detail').innerHTML=`<p class="secondary">${result.events.length} solved${result.missedCount?` · ${result.missedCount} missed the per-question flash cap`:''} · median ${fmt(stats.medianMs)} per question · 90th percentile ${fmt(stats.p90Ms)}${result.benchmark?' · valid benchmark':' · practice/unverified'}${hidden}</p>${ghostLine}${typologyHtml(typology)}${drillReviewLine(drillReview)}`;
  await refresh();
}
/**
 * The review outcome of one finished drill run, persisted. Eligibility (complete pattern drill
 * only; probes and flash drills never record) comes from `drillReviewEligible` in reviews.js.
 * Returns null when the run was not a drill, or `drillReviewOutcome` says a run had too little
 * evidence (or was interrupted), in which case nothing is written and the results panel says so.
 */
async function recordDrillReview(result) {
  const eligible = drillReviewEligible(result);
  const cellId = eligible.cellId ?? null;
  const label = skillCellFromId(cellId)?.label ?? cellId;
  if (!eligible.ok) {
    const cellEvents = (result.events ?? []).filter(e => skillOf(e)?.id === cellId);
    return { label, outcome: null, solveCount: cellEvents.length, endedEarly: result.endedEarly === true, reason: eligible.reason };
  }
  const cellEvents = (result.events ?? []).filter(e => skillOf(e)?.id === eligible.cellId);
  const outcome = drillReviewOutcome(cellEvents, { endedEarly: result.endedEarly === true });
  if (!outcome) return { label, outcome: null, solveCount: cellEvents.length, endedEarly: result.endedEarly === true, reason: 'thin-evidence' };
  const record = await recordSkillReview(eligible.cellId, outcome.wasFastAndCorrect, result.finishedAt);
  return { label, outcome, ...outcome, record };
}
/** Plain-language spacing note for the drill result panel; no claims about score gains. */
function drillReviewLine(review) {
  if(!review)return '';
  if(review.reason==='not-drill')return '';  // benchmarks and plain practice never had a review to record
  if(!review.outcome){
    const why=review.reason==='probe'?'a transfer probe is a measurement and never records reviews'
      :review.reason==='flash'?'automaticity drills do not drive the spaced ladder'
      :review.reason==='ended-early'?'run ended early — interrupted drills schedule nothing'
      :`${review.solveCount} finished problem${review.solveCount===1?'':'s'} in the cell — a review needs at least ${SKILL_REVIEW_MIN_SOLVES}`;
    return `<p class="small muted">No review recorded · ${esc(review.label)}: ${esc(why)}.</p>`;
  }
  const due=new Date(review.record.nextReviewAt).toLocaleDateString();
  const nextTier=DRILL_TIERS[drillTierForRecord(review.record)];
  const pace=review.wasFastAndCorrect
    ?`median ${fmt(review.medianMs)} at or under the ${fmt(review.fastMs)} line, ${review.cleanCount} of ${review.solveCount} solves without a wrong answer — success streak ${review.record.successes}, next review ${due}`
    :review.cleanShare < 0.5
      ?`${review.wrongAttemptSolves} of ${review.solveCount} solves answered wrong before correcting — streak reset, reviews again ${due}`
      :`median ${fmt(review.medianMs)} above the ${fmt(review.fastMs)} line — streak reset, reviews again ${due}`;
  const ladder=`next drill runs at ${esc(nextTier)} difficulty (streak-based heuristic from speed and wrong-attempt evidence)`;
  return `<p class="small muted">Pattern review recorded · ${esc(review.label)}: ${review.solveCount} solves · ${esc(pace)}. ${ladder}. Spacing heuristic; "wrong answer" means a complete wrong value typed or Enter pressed on a wrong field (self-corrected slips don't fail a review), older records carry no wrong-attempt history, and none of this promises score gains.</p>`;
}
const ERROR_LABELS={clean:'Clean entry',revision:'Revised (deleted a correct digit)',slip:'Slip (wrong digit, fixed mid-entry)',calculation:'Calculation error (complete wrong answer first)'};
function typologyHtml(t){
  if(!t.total)return '';
  return `<div class="breakdown typology" aria-label="Entry quality">${t.types.map(x=>`<div class="breakdown-row"><span>${ERROR_LABELS[x.type]}</span><div class="bar"><div style="width:${(100*(x.share??0)).toFixed(1)}%"></div></div><span>${x.count} <span class="muted">· ${fmt(x.medianMs)}</span></span></div>`).join('')}</div><p class="small muted">Counts of solved questions by entry pattern, with median solve time. Derived from keystroke telemetry; slips and revisions cost time but never cost points.</p>`;
}
function showIdle(){if(currentSession?.state==='active')return;$('#idle-layout').classList.remove('hidden');$('#top-metrics').classList.remove('hidden');$('#game').classList.add('hidden');$('#results').classList.add('hidden');activeGhostTrajectory=null;}
function renderAnalytics(){
  const allEvents=sessions.flatMap(s=>s.events??[]), ops=operationSummary(allEvents), diagnostics=diagnose(sessions);
  const worst=diagnostics.weaknesses.filter(w=>w.kind==='operation' && w.count>=5).slice(0,2);
  const recent=sessions.slice(0,8);
  const maxTime=Math.max(5000,...ops.map(x=>x.medianMs??0));
  $('#analytics-root').innerHTML=`
    <section class="panel" id="consistency-root" aria-labelledby="consistency-title"></section>
    <section class="panel" id="progression-root" aria-labelledby="progression-title"></section>
    <section class="panel" id="forecast-root" aria-labelledby="forecast-title"></section>
    <section class="panel" id="pace-root" aria-labelledby="pace-title"></section>
    <section class="panel" id="entry-root" aria-labelledby="entry-title"></section>
    <section class="panel" id="heatmap-root" aria-labelledby="heatmap-title"></section>
    <section class="panel" id="replay-root" aria-labelledby="replay-title"></section>
    <div class="panel"><h2 class="section-title">Time by operation</h2><div class="breakdown">${ops.map(o=>`<div class="breakdown-row"><span>${opNames[o.op]}</span><div class="bar"><div style="width:${Math.max(0,(o.medianMs??0)/maxTime*100)}%"></div></div><span>${fmt(o.medianMs)} <span class="muted">(${o.count}${o.ci?` · CI ${fmt(o.ci.low)}–${fmt(o.ci.high)}`:''})</span></span></div>`).join('')}</div><p class="secondary">Median per correctly solved problem across all sessions, with sample count and a 95% CI of the median once there are 6 or more. Lower is faster. Practice sessions included.</p></div>
    <div class="analysis-grid"><div class="panel"><h2 class="section-title">Current bottlenecks</h2>${worst.length?worst.map(w=>`<p class="secondary"><strong>${opNames[w.key]}</strong> · ${fmt(w.rawMedianMs)} median · ${w.count} observations</p>`).join(''):'<p class="secondary">More solved questions needed before identifying reliable weaknesses.</p>'}<p class="small muted">Heuristic, sample-size-smoothed estimates; not a validated cognitive assessment.</p></div>
    <div class="panel"><h2 class="section-title">Slowest questions</h2>${allEvents.length?[...allEvents].sort((a,b)=>b.responseMs-a.responseMs).slice(0,5).map(q=>`<div class="history-row"><span>${esc(`${q.left} ${q.symbol} ${q.right} = ${q.answer}`)}</span><strong>${fmt(q.responseMs)}</strong><span>${esc(q.op)}</span></div>`).join(''):'<div class="empty">No solved questions yet.</div>'}<button type="button" class="secondary-btn" id="replay-slow" ${allEvents.length?'':'disabled'}>Replay slowest five →</button></div></div>
    <div class="panel"><h2 class="section-title">Recent sessions</h2>${recent.length?recent.map(s=>`<div class="history-row"><span>${esc(new Date(s.startedAt).toLocaleString())} · ${esc(s.mode)}${s.benchmark?' · verified':''}</span><strong>${esc(s.score)}</strong><span>${s.benchmark?'Standard':'Practice'}</span></div>`).join(''):'<div class="empty">Your first session will appear here.</div>'}</div>
    <div class="data-actions"><button type="button" id="export-json">Export complete JSON</button><button type="button" id="export-csv">Export session CSV</button><button type="button" id="import-json">Import JSON</button><button type="button" class="warning" id="clear-history">Delete local history</button><input type="file" id="import-file" accept="application/json" hidden></div><p class="small muted">Data stays on this device unless you export it. Browsers may clear local data under storage pressure.</p>`;
  renderConsistency();
  renderProgression();
  renderForecast();
  renderPace();
  renderEntry();
  renderHeatmap();
  renderReplayUI({root:$('#replay-root'),sessions,onReplay:items=>{setView('train');showIdle();startGame({replay:items});}});
  $('#replay-slow').addEventListener('click',()=>{
    const slow=[...allEvents].sort((a,b)=>b.responseMs-a.responseMs).slice(0,5);
    if(!slow.length)return;
    setView('train');showIdle();startGame({replay:slow});
  });
  $('#export-json').addEventListener('click',async()=>downloadJson('zetamaster-sessions.json',exportBundle(sessions,await listSkillReviews().catch(()=>[]),dailyPlanRecords)));
  $('#export-csv').addEventListener('click',()=>downloadCsv('zetamaster-sessions.csv',sessions));
  $('#import-json').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    try {
      const parsed=JSON.parse(await file.text());
      const records=parseExportBundle(parsed);
      if(!records)throw new Error('No sessions found in the file.');
      const count=await importSessions(records);
      let reviews=0, plans=0;
      if(parsed && typeof parsed==='object' && Array.isArray(parsed.skillReviews)) reviews=(await importSkillReviews(parsed.skillReviews)).imported;
      if(parsed && typeof parsed==='object' && Array.isArray(parsed.dailyPlans)) plans=(await importDailyPlans(parsed.dailyPlans)).imported;
      await refresh();
      alert(`Imported ${count} sessions${reviews?`, ${reviews} skill review records`:''}${plans?` and ${plans} daily plan records`:''}.`);
    }
    catch(error){alert(`Import failed: ${error.message}`);}
  });
  $('#clear-history').addEventListener('click',async()=>{
    if(confirm('Permanently delete all ZetaMaster session history on this device?')){await deleteAllSessions();await deleteAllDailyPlans().catch(()=>{});await refresh();}
  });
}
const signed=v=>`${v>0?'+':v<0?'−':'±'}${Math.abs(v).toFixed(1)}`;
function consistencyTiles(c){
  const g=c.goal, r=c.recent, t=c.trend;
  const tile=(label,value,note)=>`<div class="metric"><span>${label}</span><strong>${value}</strong><small class="tile-note">${note}</small></div>`;
  return `<div class="stat-grid consistency-tiles">
    ${tile(`LAST ${g.window} AT ${g.target}+`,g.windowRuns?`${g.hits} / ${g.windowRuns}`:'—',g.met?`Goal met: ${g.need} of ${g.window} at ${g.target}+`:g.windowRuns<g.window?`Goal needs ${g.window} runs; you have ${g.windowRuns}`:`Goal: ${g.need} of ${g.window}`)}
    ${tile(`${g.need}TH-BEST OF LAST ${g.window}`,g.kthBest??'—',g.kthBest===null?`Needs ${g.need} runs`:g.pointsShort?`${g.pointsShort} points below ${g.target}`:`At or above ${g.target}`)}
    ${tile('RECENT MEDIAN',r.median??'—',r.ci?`95% CI ${r.ci.low}–${r.ci.high} · last ${r.n}`:r.n?`CI needs ≥6 runs (has ${r.n})`:'No standard runs yet')}
    ${tile('TREND',t?`${signed(t.slope)}<small> pts/run</small>`:'—',t?`95% CI ${signed(t.low)} to ${signed(t.high)} · last ${t.n}`:`Needs ≥6 runs`)}
  </div>`;
}
function renderConsistency(){
  const root=$('#consistency-root'); if(!root)return;
  const c=consistencySummary(sessions), g=c.goal;
  const pts=c.series;
  const verdict=!pts.length?'Complete a standard 120-second benchmark to start tracking consistency.'
    :g.met?`Goal met: ${g.hits} of your last ${g.window} standard runs scored ${g.target}+.`
    :`The goal needs at least ${g.runsToGoal} more standard run${g.runsToGoal===1?'':'s'}, even if every one scores ${g.target}+. That's a minimum, not a forecast.`;
  root.innerHTML=`<div class="section-header"><div><div class="eyebrow">CONSISTENCY · STANDARD BENCHMARKS ONLY</div><h2 class="section-title" id="consistency-title">Benchmark consistency</h2></div><span class="tag">BEST ${c.personalBest??'—'}</span></div>
    ${consistencyTiles(c)}
    <p class="secondary">${esc(verdict)}</p>
    ${pts.length?`<div class="chart-legend" aria-hidden="true"><span><i class="key-dot"></i>Benchmark score</span><span><i class="key-line"></i>Rolling median (last ${g.window})</span><span><i class="key-band"></i>10th–90th percentile (last ${g.window})</span><span><i class="key-target"></i>${g.target} target</span></div>
    <div class="chart-scroll"><div class="chart-wrap" tabindex="0" role="img" aria-describedby="consistency-help" aria-label="${esc(`Benchmark scores for ${pts.length} standard runs. Latest ${pts.at(-1).score}. Recent median ${c.recent.median}. ${g.hits} of last ${g.windowRuns} at ${g.target} or more.`)}">${scoreChartSvg(pts,g.target)}<div class="chart-tip" hidden></div></div></div>
    <p class="small muted" id="consistency-help">Hover, or focus the chart and use the arrow keys, to read each run. ${pts.length>CHART.maxRuns?`Showing the latest ${CHART.maxRuns} of ${pts.length} runs. `:''}Bands start after 3 runs and the trend after 6. Runs aren't independent trials, so read the intervals as rough.</p>
    <details class="table-view"><summary>Show table of standard runs</summary><table><thead><tr><th scope="col">Run</th><th scope="col">Date</th><th scope="col">Score</th><th scope="col">Rolling median</th><th scope="col">10th–90th pct.</th></tr></thead><tbody>${[...pts].reverse().map(p=>`<tr><td>${p.run}</td><td>${esc(new Date(p.at).toLocaleString())}</td><td>${p.score}</td><td>${p.median??'—'}</td><td>${p.p10===null?'—':`${p.p10.toFixed(1)}–${p.p90.toFixed(1)}`}</td></tr>`).join('')}</tbody></table></details>`:''}`;
  const wrap=root.querySelector('.chart-wrap'); if(!wrap)return;
  const scroller=root.querySelector('.chart-scroll'); scroller.scrollLeft=scroller.scrollWidth; // narrow screens: start at the latest runs
  const L=chartLayout(pts,g.target), svg=wrap.querySelector('svg'), tip=wrap.querySelector('.chart-tip'), hair=svg.querySelector('.crosshair');
  let idx=null;
  const show=i=>{
    idx=i; const p=L.shown[i], x=L.xs[i];
    hair.setAttribute('x1',x);hair.setAttribute('x2',x);hair.setAttribute('visibility','visible');
    tip.replaceChildren();
    const row=(value,label,cls)=>{const d=document.createElement('div');if(cls){const k=document.createElement('i');k.className=cls;d.append(k);}const b=document.createElement('strong');b.textContent=value;d.append(b,document.createTextNode(' '+label));return d;};
    const head=document.createElement('div');head.className='tip-head';head.textContent=`Run ${p.run} · ${new Date(p.at).toLocaleDateString()}`;
    tip.append(head,row(String(p.score),'score','key-dot'),row(p.median===null?'—':String(p.median),'rolling median','key-line'),row(p.p10===null?'—':`${p.p10.toFixed(0)}–${p.p90.toFixed(0)}`,'10th–90th pct.','key-band'));
    tip.hidden=false;
    const frac=x/CHART.width; tip.style.left=`${(frac*100).toFixed(2)}%`; tip.classList.toggle('flip',frac>0.6);
  };
  const hide=()=>{hair.setAttribute('visibility','hidden');tip.hidden=true;};
  wrap.addEventListener('pointermove',e=>{const box=svg.getBoundingClientRect();show(nearestIndex(L.xs,(e.clientX-box.left)/box.width*CHART.width));});
  wrap.addEventListener('pointerleave',()=>{if(document.activeElement!==wrap)hide();});
  wrap.addEventListener('focus',()=>show(idx??L.shown.length-1));
  wrap.addEventListener('blur',hide);
  wrap.addEventListener('keydown',e=>{
    const n=L.shown.length, cur=idx??n-1;
    const next={ArrowLeft:cur-1,ArrowRight:cur+1,Home:0,End:n-1}[e.key];
    if(next===undefined)return; e.preventDefault(); show(Math.max(0,Math.min(n-1,next)));
  });
}
const pct=r=>`${r>=1?'+':'−'}${Math.round(Math.abs(r-1)*100)}%`;
const FOREST=[0.6,1.6];
const forestPos=r=>(100*(Math.log(Math.min(FOREST[1],Math.max(FOREST[0],r)))-Math.log(FOREST[0]))/(Math.log(FOREST[1])-Math.log(FOREST[0]))).toFixed(2);
/** Histogram section (F41): mixes only module-provided numbers and fixed labels; bars reuse .bar. */
function histogramSection(hist){
  const head=`<h3 class="subhead">Adjusted solve-time distribution across runs</h3>`;
  if(hist.insufficient)return `${head}<p class="secondary">Insufficient: the histogram needs at least ${hist.minObs} adjusted solves and ${hist.observations} analyzed${hist.runs?` across ${hist.runs} standard run${hist.runs===1?'':'s'}`:''}. All bins stay gated until that minimum, whatever their shape.</p>`;
  const max=Math.max(...hist.bins.map(b=>b.count));
  const rows=hist.bins.map(b=>`<tr${b.tail?' class="hist-tail"':''}><th scope="row">${esc(b.label)}</th><td><div class="bar" aria-hidden="true"><div style="width:${max?(100*b.count/max).toFixed(2):0}%"></div></div></td><td>${b.count} <span class="muted">· ${(100*b.share).toFixed(1)}%</span></td></tr>`).join('');
  const t=hist.tailTrend;
  const movement=t?`<p class="secondary">Tail movement (share of solves ≥×2 per run): ${signed(t.slope*100)}<small> pp/run</small> · 95% CI ${signed(t.low*100)} to ${signed(t.high*100)} · last ${t.n} runs · Theil–Sen, needs ≥6 runs.</p>`:'';
  const tailPct=`${(100*hist.tailShare).toFixed(1)}% (${Math.round(hist.tailShare*hist.observations)}/${hist.observations})`;
  const cutNote=hist.tailShare===hist.slowShare?'also matches the slow-question share above, because the robust cutoff sits exactly at ×2':hist.cutoffOnEdge?'a little larger than the slow-question share above when solves land exactly on the ×2 edge — the bins count them, the strict slow rule does not':'smaller than this share when the robust slow-question cutoff moves past ×2, which the tiles above report';
  return `${head}<table class="mini-table hist-table" aria-label="Histogram of operation-adjusted relative solve times pooled across standard runs"><thead><tr><th scope="col">Bin</th><th scope="col">Share of solves</th><th scope="col">Solves</th></tr></thead><tbody>${rows}</tbody></table>${movement}<p class="small muted">Fixed bins: below ×0.5, ×0.5–0.75, ×0.75–1, ×1–1.5, ×1.5–2, ×2–3, ≥×3; each ratio lands in the bin whose lower edge it reaches. Bars scale to the largest bin; every row shows its exact count and share. Solves at least twice your typical operation time (tail, orange): ${esc(tailPct)}, ${esc(cutNote)}.${hist.engine1?` ${hist.engine1} solves from old engine-1 records use an estimated start time.`:''} Definitions and edge rules: docs/FATIGUE.md.</p>`;
}

function renderProgression() {
  const root = $("#progression-root"); if (!root) return;
  const p = evaluateProgression(sessions);
  const tile = (label, value, note) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small class="tile-note">${note}</small></div>`;

  const tiles = `<div class="stat-grid consistency-tiles">
    ${tile("CURRENT TIER", `${p.stage.name} (L${p.stage.level})`, `${p.stage.minScore}–${p.stage.targetScore} pts threshold`)}
    ${tile("ROLLING MEDIAN", p.medianScore !== null ? p.medianScore.toFixed(1) : "—", p.status === "active" ? `Last ${p.windowRuns} standard runs` : `${p.benchmarkCount}/${p.minRunsNeeded} runs to baseline`)}
    ${tile("TO NEXT STAGE", p.pointsToNext !== null ? (p.pointsToNext === 0 ? "Max tier" : `${p.pointsToNext.toFixed(1)} pts`) : "—", p.nextStage ? `Target ${p.stage.targetScore} for ${p.nextStage.name}` : "Mastery achieved")}
    ${tile("MASTERY GOAL", p.mastery70Met ? "Unlocked" : (p.consistency ? `${p.consistency.hits} / ${p.consistency.windowRuns}` : "0 / 10"), "8 of 10 runs ≥ 70")}
  </div>`;

  const cards = PROGRESSION_STAGES.map(s => {
    const isCurrent = s.id === p.stage.id;
    const isDone = s.level < p.stage.level;
    const badge = isCurrent ? '<span class="ladder-badge active">CURRENT TIER</span>' : (isDone ? '<span class="ladder-badge done">PASSED</span>' : '<span class="ladder-badge next">UPCOMING</span>');
    return `<div class="ladder-card${isCurrent ? " active" : ""}">
      <div class="ladder-card-head">
        <span class="ladder-card-title">Stage ${s.level}: ${esc(s.name)} (${s.minScore}–${s.targetScore} pts)</span>
        ${badge}
      </div>
      <p class="secondary" style="margin:4px 0"><strong>${esc(s.focus)}</strong> — ${esc(s.description)}</p>
      <p class="small muted">Recommended actions: ${esc(s.recommendedActions.join(", "))}</p>
    </div>`;
  }).join("");

  root.innerHTML = `<div class="section-header">
    <div>
      <div class="eyebrow">SKILL PROGRESSION LADDER · STANDARD BENCHMARKS ONLY</div>
      <h2 class="section-title" id="progression-title">Milestone progression ladder</h2>
    </div>
    <span class="tag">TIER ${p.stage.level}: ${esc(p.stage.name.toUpperCase())}</span>
  </div>
  ${tiles}
  <p class="secondary">${esc(p.note)}</p>
  <div class="ladder-grid">${cards}</div>
  <p class="small muted">Progression is governed by your rolling median across standard benchmark sessions (window: 10 runs, gated at >= 3 runs). Practice modes, drills, and isolation sessions do not affect ladder placement.</p>`;
}

function renderForecast() {
  const root = $("#forecast-root"); if (!root) return;
  const f = forecastProgress(sessions, { horizon: DEFAULT_FORECAST_HORIZON, confidence: 0.80 });
  const tile = (label, value, note) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small class="tile-note">${note}</small></div>`;

  if (f.abstain) {
    root.innerHTML = `<div class="section-header">
      <div>
        <div class="eyebrow">LONGITUDINAL FORECASTING · F37</div>
        <h2 class="section-title" id="forecast-title">Progress forecast & prediction intervals</h2>
      </div>
      <span class="tag">SAMPLE GATE (${f.benchmarkCount}/${f.minRunsNeeded})</span>
    </div>
    <div class="stat-grid consistency-tiles">
      ${tile("STANDARD RUNS", `${f.benchmarkCount} / ${f.minRunsNeeded}`, `Needs ${f.minRunsNeeded - f.benchmarkCount} more to unlock`)}
      ${tile("CURRENT MEDIAN", f.currentMedian !== null ? f.currentMedian.toFixed(1) : "—", "Verified benchmark scope")}
      ${tile("PROJECTION", "Abstaining", "Safeguard active")}
      ${tile("GATE POLICY", `${MIN_FORECAST_RUNS} runs`, "Prevents spurious precision")}
    </div>
    <p class="secondary">${esc(f.reason)}</p>
    <p class="small muted">${esc(f.limitation)} Calibrated projections use held-out rolling-origin cross-validation on verified benchmark series. Unverified and practice sessions are excluded.</p>`;
    return;
  }

  const series = benchmarkSeries(sessions);
  const tiles = `<div class="stat-grid consistency-tiles">
    ${tile(`PROJECTED (+${f.horizonRuns} RUNS)`, `~${f.projectedScore}`, `${f.interval.lower}–${f.interval.upper} (${Math.round(f.interval.confidenceLevel * 100)}% interval)`)}
    ${tile("THEIL-SEN SLOPE", `${f.slopePerRun >= 0 ? "+" : ""}${f.slopePerRun.toFixed(2)}<small> pts/run</small>`, "Pairwise median rate")}
    ${tile("CV UNCERTAINTY", `±${f.calibration.mae.toFixed(1)} MAE`, `${f.calibration.crossValidatedRuns} rolling splits`)}
    ${tile("BENCHMARK COUNT", `${f.benchmarkCount} runs`, `Median ${f.currentMedian.toFixed(1)} pts`)}
  </div>`;

  const legend = `<div class="chart-legend" aria-hidden="true">
    <span><i class="key-dot"></i>Benchmark score</span>
    <span><i class="key-forecast-line"></i>Theil–Sen projection</span>
    <span><i class="key-forecast-band"></i>80% prediction interval</span>
    <span><i class="key-target"></i>70 target</span>
  </div>`;

  const svg = forecastChartSvg(series, f, 70);

  root.innerHTML = `<div class="section-header">
    <div>
      <div class="eyebrow">LONGITUDINAL FORECASTING · F37</div>
      <h2 class="section-title" id="forecast-title">Progress forecast & prediction intervals</h2>
    </div>
    <span class="tag">CALIBRATED FORECAST</span>
  </div>
  ${tiles}
  <p class="secondary">At your empirical rate of ${f.slopePerRun >= 0 ? "+" : ""}${f.slopePerRun.toFixed(2)} points per standard benchmark, projected performance in ${f.horizonRuns} runs is approximately <strong>${f.projectedScore} points</strong> with an 80% prediction interval of [${f.interval.lower}–${f.interval.upper}].</p>
  ${legend}
  <div class="chart-scroll"><div class="chart-wrap" tabindex="0" role="img" aria-label="${esc(`Progress forecast: projected score ${f.projectedScore} in ${f.horizonRuns} runs with interval ${f.interval.lower} to ${f.interval.upper}`)}">${svg}</div></div>
  <p class="small muted">${esc(f.limitation)} Prediction intervals widen with horizon (${f.horizonRuns} runs) and calibrate from empirical cross-validation error across rolling origins.</p>`;
}

function renderPace(){
  const root=$('#pace-root'); if(!root)return;
  const pace=paceProfile(sessions), tail=tailProfile(sessions), hist=relativeHistogram(sessions), h=pace.halfShift;
  const tile=(label,value,note)=>`<div class="metric"><span>${label}</span><strong>${value}</strong><small class="tile-note">${note}</small></div>`;
  const head=`<div class="section-header"><div><div class="eyebrow">PACE · STANDARD BENCHMARKS ONLY</div><h2 class="section-title" id="pace-title">Pace through the run &amp; slow questions</h2></div></div>`;
  if(pace.runs<3||!pace.observations){root.innerHTML=`${head}<p class="secondary">Needs at least 3 standard benchmarks (you have ${pace.runs}). Each solve time is compared with your typical time for that operation, so a run that happened to get harder problems late doesn't look like fatigue.</p>`;return;}
  const segLabel=s=>`${Math.round(s.fromFrac*120)}–${Math.round(s.toFrac*120)} s`;
  root.innerHTML=`${head}
    <div class="stat-grid consistency-tiles pace-tiles">
      ${tile('2ND HALF VS 1ST',h.ratio===null?'—':pct(h.ratio),h.ratio===null?`Needs 3 runs with ≥3 solves per half (has ${h.runs})`:h.ci?`95% CI ${pct(h.ci.low)} to ${pct(h.ci.high)} · ${h.runs} runs · + means slower`:`${h.runs} runs · CI needs ≥6`)}
      ${tile('SLOW QUESTIONS',tail.slowShare===null?'—':`${(100*tail.slowShare).toFixed(1)}%`,tail.cutoffRatio?`of solves took over ${tail.cutoffRatio.toFixed(1)}× your typical time for that operation`:'')}
      ${tile('TIME LOST / RUN',tail.excessPerRun===null?'—':fmt(tail.excessPerRun),tail.questionsPerRun===null?'':`≈ ${tail.questionsPerRun.toFixed(1)} questions at your median pace (rough upper bound)`)}
    </div>
    <h3 class="subhead">Relative solve time by part of the run</h3>
    <div class="forest" role="table" aria-label="Median solve time relative to your typical time for the operation, by part of the run">
      <div class="forest-row forest-axis" role="row" aria-hidden="true"><span></span><div class="forest-track">${[0.75,1,1.25,1.5].map(v=>`<span class="forest-tick" style="left:${forestPos(v)}%">×${v}</span>`).join('')}</div><span></span></div>
      ${pace.segments.map(sg=>`<div class="forest-row" role="row"><span role="rowheader">${segLabel(sg)}</span><div class="forest-track" role="cell" aria-label="${sg.ratio===null?'no data':`×${sg.ratio.toFixed(2)}${sg.ci?`, 95% CI ×${sg.ci.low.toFixed(2)} to ×${sg.ci.high.toFixed(2)}`:''}`}"><i class="forest-ref" style="left:${forestPos(1)}%"></i>${sg.ci?`<i class="forest-ci" style="left:${forestPos(sg.ci.low)}%;width:${(forestPos(sg.ci.high)-forestPos(sg.ci.low)).toFixed(2)}%"></i>`:''}${sg.ratio===null?'':`<i class="forest-dot" style="left:${forestPos(sg.ratio)}%"></i>`}</div><span role="cell" class="forest-val">${sg.ratio===null?'—':`×${sg.ratio.toFixed(2)}`} <span class="muted">· ${sg.n} solves · ${fmt(sg.rawMedianMs)} raw</span></span></div>`).join('')}
    </div>
    <p class="small muted">×1.00 = your typical time for that operation. Dots are medians and bars are 95% intervals. Two caveats: the question left unsolved at the buzzer isn't counted, which can make the last part look slightly faster, and the first segment includes getting started.</p>
    <div class="analysis-grid pace-grid">
      <div><h3 class="subhead">Tail by operation</h3><table class="mini-table"><thead><tr><th scope="col">Operation</th><th scope="col">Median</th><th scope="col">90th pct.</th><th scope="col">90th ÷ median</th><th scope="col">Slow</th></tr></thead><tbody>${tail.byOp.map(o=>`<tr><th scope="row">${opNames[o.op]}</th><td>${fmt(o.p50)}</td><td>${fmt(o.p90)}</td><td>×${o.tailRatio.toFixed(2)}</td><td>${o.slow} <span class="muted">/ ${o.n}</span></td></tr>`).join('')}</tbody></table></div>
      <div><h3 class="subhead">Costliest stalls</h3>${tail.worst.length?`<table class="mini-table"><thead><tr><th scope="col">Problem</th><th scope="col">Took</th><th scope="col">Typical</th><th scope="col">Run</th></tr></thead><tbody>${tail.worst.map(w=>`<tr><th scope="row">${esc(w.label)}</th><td>${fmt(w.responseMs)}</td><td>${fmt(w.opMedianMs)}</td><td>${w.run}</td></tr>`).join('')}</tbody></table>`:'<p class="secondary">No slow questions by this rule.</p>'}</div>
    </div>
    ${histogramSection(hist)}
    <p class="small muted">"Slow" means over the larger of 2× your typical time and a robust outlier cutoff (median + 3 MADs on the log scale). Time lost is the median per run of the time beyond typical spent on slow questions. Definitions: docs/FATIGUE.md.</p>`;
}
const OP_GLYPH={add:'+',sub:'–',mul:'×',div:'÷'};
const ENTRY_SHORT={clean:'Clean',revision:'Revised',slip:'Slip',calculation:'Calculation'};
function renderEntry(){
  const root=$('#entry-root'); if(!root)return;
  const q=entryQuality(sessions);
  let calibLine='';
  try {
    const stored=localStorage.getItem('zetamaster-calibration');
    if(stored){
      const c=JSON.parse(stored);
      calibLine=`<div class="subline-inline" style="margin:10px 0;padding:8px 12px;background:#152433;border-radius:8px;border:1px solid #283e54">Calibrated hardware overhead: <strong>${c.medianMs.toFixed(0)} ms</strong> median (${c.msPerDigit?`${c.msPerDigit} ms/digit, `:''}${Math.round(c.accuracy*100)}% accuracy). <button type="button" class="link-btn" id="recalib-link">Recalibrate ↗</button></div>`;
    }
  }catch{}
  const tile=(label,value,note)=>`<div class="metric"><span>${label}</span><strong>${value}</strong><small class="tile-note">${note}</small></div>`;
  const head=`<div class="section-header"><div><div class="eyebrow">ENTRY QUALITY · STANDARD BENCHMARKS ONLY</div><h2 class="section-title" id="entry-title">Entry quality across runs</h2></div><span class="tag">${q.runs} RUN${q.runs===1?'':'S'}</span></div>`;
  if(!q.runs){root.innerHTML=`${head}<p class="secondary">Complete standard 120-second benchmarks to unlock this panel. Practice sessions and drills are excluded so entry types stay comparable across runs.</p>`;return;}
  if(!q.observations){root.innerHTML=`${head}<p class="secondary">Your ${q.runs} standard run${q.runs===1?'':'s'} contain no solved questions to analyze.</p>`;return;}
  const clean=q.costs[0], calc=q.costs.at(-1);
  const flawed=q.observations-clean.count;
  const ratioTxt=c=>c.ratio===null?'—':`×${c.ratio.toFixed(2)}${c.ci?` <span class="muted">· CI ×${c.ci.low.toFixed(2)}–${c.ci.high.toFixed(2)}</span>`:''}`;
  const lostTxt=c=>c.count===0||c.lostMs===null?'—':fmt(c.lostMs)+(c.lostCI?` <span class="muted">· CI ${fmt(c.lostCI.low)}–${fmt(c.lostCI.high)}</span>`:'');
  const splitTxt=c=>c.count===0?'—':c.splitN<MIN_TYPE_SAMPLES?'insufficient':fmt(c.firstMs);
  const typeTable=`<table class="mini-table"><thead><tr><th scope="col">Type</th><th scope="col">Solves</th><th scope="col">vs clean entry</th><th scope="col">Lost / run</th><th scope="col">To 1st key (proxy)</th><th scope="col">Typing after</th></tr></thead><tbody>${q.costs.map(c=>`<tr><th scope="row">${ENTRY_SHORT[c.type]}</th><td>${c.count}</td><td>${ratioTxt(c)}</td><td>${lostTxt(c)}</td><td>${splitTxt(c)}</td><td>${c.count===0?'—':c.splitN<MIN_TYPE_SAMPLES?'insufficient':fmt(c.entryMs)}</td></tr>`).join('')}</tbody></table>`;
  const opCell=c=>c.n===0?'—':c.n<MIN_TYPE_SAMPLES?`${c.n} <span class="muted">low n</span>`:`${c.n} <span class="muted">×${c.ratio.toFixed(2)}</span>`;
  const opTable=`<table class="mini-table"><thead><tr><th scope="col">Operation</th><th scope="col">Clean</th><th scope="col">Revised</th><th scope="col">Slip</th><th scope="col">Calculation</th></tr></thead><tbody>${q.byOp.map(o=>`<tr><th scope="row">${opNames[o.op]}</th>${o.types.map(c=>`<td>${opCell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const trend=q.calcTrend;
  const notes=`<p class="small muted">vs clean entry = solve time ÷ that operation's clean-entry median, so a slow operation doesn't make its errors look worse. Lost/run = median across runs of Σ(time − clean-entry median) over that type's questions. First-key times are a proxy for thinking time. Rate medians and CIs need ≥6 observations; operation cells under ${MIN_TYPE_SAMPLES} solves show "low n".${q.baselineMixed?' Some operations lack clean-entry samples, so their comparisons fall back to the overall operation median.':''}${q.engine1Events?` ${q.engine1Events} question(s) from old engine-1 records: every correction in them is counted as a slip.`:''} Definitions and caveats: docs/ENTRY_QUALITY.md.</p>`;
  root.innerHTML=`${head}
    <div class="stat-grid consistency-tiles">
      ${tile('NOT CLEAN',(100*flawed/q.observations).toFixed(1)+'%',esc(`${flawed} of ${q.observations} solves had an edit, slip or wrong answer first · ${q.runs} standard runs`))}
      ${tile('TIME LOST / RUN',fmt(q.lostTotal),esc(q.lostTotalCI?`95% CI ${fmt(q.lostTotalCI.low)}–${fmt(q.lostTotalCI.high)} · beyond clean entry, per operation`:`beyond clean entry, per operation · CI needs ≥6 runs`))}
      ${tile('CALCULATION TREND',trend?`${signed(trend.slope*100)}<small> pp/run</small>`:'—',esc(trend?`95% CI ${signed(trend.low*100)} to ${signed(trend.high*100)} · share of solves, last ${trend.n} runs`:`Calculation errors per run · needs ≥6 standard runs (has ${q.runs})`))}
      ${tile('ROUGH QUESTION COST',q.questionsPerRun===null?'—':'≈ '+q.questionsPerRun.toFixed(1),esc('same time as questions at your median pace · rough upper bound, not a promised score gain'))}
    </div>
    ${q.runs<6?`<p class="secondary">Only ${q.runs} standard run${q.runs===1?'':'s'}: counts and totals are exact, but medians and shares stabilize around 6 or more runs, and the trend needs 6.</p>`:''}
    <h3 class="subhead">Relative solve time by entry type</h3>
    <div class="forest" role="table" aria-label="Median solve time relative to clean entry for the same operation, by entry type">
      <div class="forest-row forest-axis" role="row" aria-hidden="true"><span></span><div class="forest-track">${[0.75,1,1.25,1.5].map(v=>`<span class="forest-tick" style="left:${forestPos(v)}%">×${v}</span>`).join('')}</div><span></span></div>
      ${q.costs.filter(c=>c.count).map(c=>`<div class="forest-row${c.type==='calculation'?' entry-calc':''}" role="row"><span role="rowheader">${ENTRY_SHORT[c.type]}</span><div class="forest-track" role="cell" aria-label="${esc(`${c.count} ${ENTRY_SHORT[c.type].toLowerCase()} solves, median ${c.ratio===null?'no data':`×${c.ratio.toFixed(2)}`}${c.ci?`, 95% CI ×${c.ci.low.toFixed(2)} to ×${c.ci.high.toFixed(2)}`:''} of the clean-entry time for the same operation, ${fmt(c.lostMs)} lost per run`)}"><i class="forest-ref" style="left:${forestPos(1)}%"></i>${c.ci?`<i class="forest-ci" style="left:${forestPos(c.ci.low)}%;width:${(forestPos(c.ci.high)-forestPos(c.ci.low)).toFixed(2)}%"></i>`:''}${c.ratio===null?'':`<i class="forest-dot" style="left:${forestPos(c.ratio)}%"></i>`}</div><span role="cell" class="forest-val">${c.ratio===null?'—':`×${c.ratio.toFixed(2)}`} <span class="muted">· ${c.count} solves · ${fmt(c.lostMs)} lost/run</span></span></div>`).join('')}
    </div>
    <p class="small muted">×1.00 is your clean-entry time for the same operation; the calculation row (orange) is the only type that types a whole wrong answer first. Relative time and lost time can disagree in order: an error on a fast operation can cost little time yet sit far above clean entry.</p>
    <div class="analysis-grid entry-grid">
      <div><h3 class="subhead">Cost and entry split by type</h3><div class="chart-scroll">${typeTable}</div>
      <div><h3 class="subhead">By operation</h3><div class="chart-scroll">${opTable}</div><p class="small muted">Each cell is solved count with the median relative to that operation's clean-entry time; "low n" marks short samples.</p></div>
    </div>
    <details class="table-view"><summary>Show per-run calculation share</summary><table><thead><tr><th scope="col">Run</th><th scope="col">Solved</th><th scope="col">Calculation share</th><th scope="col">Time lost</th></tr></thead><tbody>${[...q.perRun].reverse().map(r=>`<tr><td>${r.run}</td><td>${r.solved}</td><td>${(100*r.calculation/Math.max(1,r.solved)).toFixed(1)}%</td><td>${fmt(r.lostMs)}</td></tr>`).join('')}</tbody></table></details>
    ${calibLine}
    <div style="margin:14px 0"><button type="button" class="secondary-btn" id="analytics-calibration">Hardware latency calibration ↗</button></div>
    ${notes}`;
  $('#analytics-calibration')?.addEventListener('click',openCalibrationModal);
  $('#recalib-link')?.addEventListener('click',openCalibrationModal);
}
function cellColor(c){
  if(c.count<MIN_CELL_SAMPLES||c.ratio===null)return 'transparent';
  const strength=Math.min(1,Math.abs(Math.log2(c.ratio))/1.2);
  return c.ratio>=1?`rgba(251,140,120,${(0.12+0.6*strength).toFixed(2)})`:`rgba(110,231,183,${(0.1+0.45*strength).toFixed(2)})`;
}
function cellAria(c,h){
  if(!c.count)return `${c.label}: no observations`;
  const rel=c.ratio===null?'':` ${Math.round(Math.abs(c.ratio-1)*100)}% ${c.ratio>=1?'slower':'faster'} than your ${opNames[h.op].toLowerCase()} median after smoothing.`;
  return `${c.label}: ${c.count} solved, median ${fmt(c.medianMs)}.${c.count<MIN_CELL_SAMPLES?' Too few samples.':rel}`;
}
function cellDetailHtml(c,h){
  if(!c)return '<p class="secondary">Select a cell (arrow keys + Enter, or click) to see details and start a drill.</p>';
  const ci=c.ci?`${fmt(c.ci.low)} – ${fmt(c.ci.high)}`:`needs ≥6 samples (has ${c.count})`;
  const rel=c.ratio===null||c.count<MIN_CELL_SAMPLES?'—':`${c.ratio>=1?'+':'−'}${Math.round(Math.abs(c.ratio-1)*100)}% vs ${opNames[h.op].toLowerCase()} median (${fmt(h.opMedianMs)})`;
  const mastery=c.mastery?`${Math.round(c.mastery.estimate*100)}% (95% interval ${Math.round(c.mastery.ci.low*100)}–${Math.round(c.mastery.ci.high*100)}%, n=${c.mastery.samples})`:'—';
  return `<h3 class="cell-title">${esc(c.label)}</h3>
    <dl class="cell-stats"><dt>Solved</dt><dd>${c.count} <span class="muted">(${esc(c.evidence)})</span></dd><dt>Median</dt><dd>${fmt(c.medianMs)}</dd><dt>95% CI of median</dt><dd>${ci}</dd><dt>Smoothed relative speed</dt><dd>${rel}</dd><dt>Not clean entry</dt><dd>${c.flawedShare===null?'—':Math.round(100*c.flawedShare)+'%'}</dd><dt>Mastery ≤2s</dt><dd>${mastery}</dd></dl>
    <button type="button" class="primary-btn" id="drill-cell">Drill ${esc(c.label)} · 60s practice ↗</button>
    <button type="button" class="secondary-btn" id="flash-cell">Automaticity drill · flash 60s ↗</button>
    <p class="small muted">Drills only show problems from this cell and are saved as practice. They never count toward benchmark scores, and they're excluded from the benchmark-only heatmap. A finished 60-second drill records a spaced review for this pattern (speed and wrong-attempt based), and later drills auto-tune: a lapse narrows to the easier half of the cell, four consecutive fast runs stretch into the neighboring band (Train tab → due reviews). The automaticity drill adds a 2-second flash cap per question and does not feed that ladder. Mastery is a Jeffreys-posterior share of recorded solves that are correct and at or under the 2 s line in the scope above; the interval is not calibrated against scores — a description of this cell's record, not a prediction.</p>`;
}
function renderHeatmap(){
  const root=$('#heatmap-root'); if(!root)return;
  const h=buildHeatmap(sessions,heatmapState.op,{scope:heatmapState.scope});
  const inGrid=pos=>pos&&pos.row<h.rows.length&&pos.col<h.cols.length;
  if(!inGrid(heatmapState.focus))heatmapState.focus={row:0,col:0};
  if(heatmapState.selected&&!inGrid(heatmapState.selected))heatmapState.selected=null;
  const {row:fr,col:fc}=heatmapState.focus;
  const sel=heatmapState.selected;
  const selectedCell=sel?h.cells[sel.row]?.[sel.col]:null;
  const slow=slowestCells(h);
  const otherScopeCount=buildHeatmap(sessions,heatmapState.op,{scope:heatmapState.scope==='benchmark'?'all':'benchmark'}).observations;
  root.innerHTML=`<div class="section-header"><div><div class="eyebrow">WEAKNESS MAP</div><h2 class="section-title" id="heatmap-title">${opNames[h.op]} heatmap</h2></div>
    <div class="heatmap-controls"><div class="segmented" role="radiogroup" aria-label="Operation">${['add','sub','mul','div'].map(op=>`<button type="button" role="radio" aria-checked="${op===h.op}" data-hm-op="${op}" class="chip${op===h.op?' selected':''}">${OP_GLYPH[op]} ${opNames[op]}</button>`).join('')}</div>
    <label class="field inline"><span>DATA</span><select id="hm-scope"><option value="benchmark"${h.scope==='benchmark'?' selected':''}>Standard benchmarks only</option><option value="all"${h.scope==='all'?' selected':''}>All sessions (incl. drills)</option></select></label></div></div>
    <p class="secondary">${h.observations?`${h.observations} solved ${opNames[h.op].toLowerCase()} problems · operation median ${fmt(h.opMedianMs)}.`:`No solved ${opNames[h.op].toLowerCase()} problems in this scope yet.${otherScopeCount?` ${otherScopeCount} in the other data scope.`:''}`} Cells show median seconds and sample count. Warm = slower than your usual, cool = faster. Cells with fewer than ${MIN_CELL_SAMPLES} samples stay blank.</p>
    ${slow.length?`<p class="small">Slowest reliable cells: ${slow.map(c=>`<button type="button" class="link-btn" data-hm-jump="${c.row}:${c.col}">${esc(c.label)}</button>`).join(', ')}</p>`:''}
    <div class="heatmap-layout"><div class="heatmap-scroll"><table class="heatmap" role="grid" aria-labelledby="heatmap-title" aria-describedby="heatmap-help">
      <thead><tr><th scope="col" class="corner"><span class="sr-only">${esc(h.rowAxis)} by ${esc(h.colAxis)}</span><span aria-hidden="true">${esc(h.rowAxis)} ↓ · ${esc(h.colAxis)} →</span></th>${h.cols.map(c=>`<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${h.cells.map((row,r)=>`<tr><th scope="row">${esc(h.rows[r].label)}</th>${row.map(c=>`<td role="gridcell" tabindex="${r===fr&&c.col===fc?0:-1}" data-row="${r}" data-col="${c.col}" aria-selected="${sel?.row===r&&sel?.col===c.col}" aria-label="${esc(cellAria(c,h))}" class="hm-cell ${c.evidence}${sel?.row===r&&sel?.col===c.col?' is-selected':''}" style="background:${cellColor(c)}">${c.count>=MIN_CELL_SAMPLES?`<span class="hm-val">${(c.medianMs/1000).toFixed(1)}</span><span class="hm-n">${c.count}</span>`:c.count?`<span class="hm-n">${c.count}</span>`:''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <aside class="heatmap-detail" aria-live="polite">${cellDetailHtml(selectedCell,h)}</aside></div>
    <p class="small muted" id="heatmap-help">Keyboard: arrow keys move, Home/End jump to row edges, Enter or Space selects. Medians are descriptive. Intervals assume independent attempts, which repeated practice violates, so read them as rough.</p>`;
  root.querySelectorAll('[data-hm-op]').forEach(b=>b.addEventListener('click',()=>{heatmapState.op=b.dataset.hmOp;heatmapState.selected=null;heatmapState.focus={row:0,col:0};syncHeatmapHash();renderHeatmap();}));
  $('#hm-scope').addEventListener('change',e=>{heatmapState.scope=e.target.value;syncHeatmapHash();renderHeatmap();});
  root.querySelectorAll('[data-hm-jump]').forEach(b=>b.addEventListener('click',()=>{const [r,c]=b.dataset.hmJump.split(':').map(Number);selectCell(r,c,true);}));
  const grid=root.querySelector('.heatmap');
  grid.addEventListener('click',e=>{const td=e.target.closest('td[data-row]');if(td)selectCell(Number(td.dataset.row),Number(td.dataset.col),true);});
  grid.addEventListener('keydown',e=>{
    const td=e.target.closest('td[data-row]');if(!td)return;
    const pos={row:Number(td.dataset.row),col:Number(td.dataset.col)};
    if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCell(pos.row,pos.col,true);return;}
    const next=nextGridPosition(pos,e.key,h.rows.length,h.cols.length,{ctrl:e.ctrlKey||e.metaKey});
    if(!next)return;
    e.preventDefault();
    grid.querySelectorAll('td[tabindex="0"]').forEach(x=>x.tabIndex=-1);
    const target=grid.querySelector(`td[data-row="${next.row}"][data-col="${next.col}"]`);
    target.tabIndex=0;target.focus();heatmapState.focus=next;
  });
  $('#drill-cell')?.addEventListener('click',()=>{
    setView('train');showIdle();
    startGame({drill:{op:h.op,id:selectedCell.key,label:selectedCell.label,rowRange:selectedCell.rowRange,colRange:selectedCell.colRange},provenance:{surface:'heatmap',cellId:selectedCell.key}});
  });
  $('#flash-cell')?.addEventListener('click',()=>{
    setView('train');showIdle();
    // F31: latency-bound flash run; `stage:'flash'` marks it so the spaced ladder ignores it.
    startGame({drill:{op:h.op,id:selectedCell.key,label:selectedCell.label,rowRange:selectedCell.rowRange,colRange:selectedCell.colRange,stage:'flash'},provenance:{surface:'heatmap',cellId:selectedCell.key,stage:'flash'}});
  });
}
function selectCell(row,col,focus){
  heatmapState.selected={row,col};heatmapState.focus={row,col};syncHeatmapHash();renderHeatmap();
  if(focus)$(`#heatmap-root td[data-row="${row}"][data-col="${col}"]`)?.focus();
}
function syncHeatmapHash(){history.replaceState(null,'',heatmapHash(heatmapState.op,heatmapState.scope,heatmapState.selected));}
function applyHeatmapHash(){
  const parsed=parseHeatmapHash(location.hash); if(!parsed)return false;
  heatmapState.op=parsed.op;heatmapState.scope=parsed.scope;
  heatmapState.selected=parsed.cell;heatmapState.focus=parsed.cell??{row:0,col:0};
  setView('analytics');return true;
}
// Interactive guided lessons (M3 slice 1, F23–F25): untimed step-by-step rehearsal of the Academy
// technique cards. All arithmetic comes from packages/curriculum/src/guides.js (pinned by
// tests/guides.test.js against the cards' own example text — nothing is inferred here); the mode
// chips pick guided / partial / independent asking, transfer draws fresh seeded problems for the
// same technique, and the hand-off reuses the existing drill launch path so every run stays
// practice-only and no new score surface, persistence or timing exists in this panel.
const academy={lessonId:null,mode:'guided',seed:null,transfer:false,asking:0,done:false,message:''};
const ACADEMY_MODE_LABELS={guided:'Guided',partial:'Reveal steps',independent:'On my own'};
const ACADEMY_NO_DRILL={'multiply-halve':'The ×25 pair never occurs in the benchmark operand space (25 is not a 2–12 table factor), so no pattern drill exists for it.'};

/** Card-example operand parser for canonical rehearsal, independent of the technique modules. */
function academyCardOperands(lesson){
  const match=/^(\d+) ([+−×÷]) (\d+)$/.exec(lesson.example);
  return match?{a:Number(match[1]),b:Number(match[3])}:null;
}
function academyPlan(){
  const lesson=LESSONS.find(l=>l.id===academy.lessonId);
  if(!lesson)return null;
  if(academy.transfer&&academy.seed)return transferPlan(lesson.id,academy.seed);
  const operands=academyCardOperands(lesson);
  return operands?planForLesson(lesson.id,operands.a,operands.b):null;
}
function academyInputTarget(plan,ask){
  if(academy.done)return null;
  if(!ask.showSteps)return {prompt:plan.final.prompt,answer:plan.final.answer};
  const step=plan.steps[academy.asking];
  return step?{prompt:step.prompt,answer:step.answer}:null;
}
function academyResetProgress(){
  const plan=academyPlan();
  const ask=plan?askPlan(plan,academy.mode):null;
  Object.assign(academy,{asking:ask?ask.asks[0]:0,done:false,message:''});
}
function academyCheck(raw){
  const plan=academyPlan();if(!plan)return;
  const ask=askPlan(plan,academy.mode);
  const target=academyInputTarget(plan,ask);if(!target)return;
  if(!checkGuideAnswer(raw,target.answer)){academy.message='Not this one — recompute and re-enter.';renderLessons();return;}
  const next=ask.asks.find(index=>index>academy.asking);
  if(next===undefined)academy.done=true;
  else academy.asking=next;
  academy.message='';
  renderLessons();
}
function academyToggle(id){
  if(academy.lessonId===id)academy.lessonId=null;
  else Object.assign(academy,{lessonId:id,transfer:false,seed:null});
  academyResetProgress();
  renderLessons();
}
function academyMode(id,mode){
  if(!GUIDE_MODES.includes(mode))return;
  Object.assign(academy,{lessonId:id,mode}); // same problem, restart the rehearsal for the new asking
  academyResetProgress();
  renderLessons();
}
function academyTransfer(id){
  Object.assign(academy,{lessonId:id,transfer:true,seed:crypto.randomUUID()});
  academyResetProgress();
  renderLessons();
}
function academyStepRow(step,index,ask,plan){
  const done=academy.done;
  if(!ask.showSteps)return '';
  const complete=index<academy.asking||ask.asks.every(i=>i!==index)||done;
  const isCurrent=!done&&index===academy.asking&&ask.asks.includes(index);
  if(complete)return `<div class="academy-step"><span class="prompt">${esc(step.prompt)}</span><span class="reveal">= ${esc(step.answer)}</span></div>`;
  if(isCurrent)return `<div class="academy-step"><span class="prompt">${esc(step.prompt)}</span><input id="academy-answer" type="text" inputmode="numeric" autocomplete="off" maxlength="${MAX_FIELD}" placeholder="?" aria-label="answer for ${esc(step.prompt)}">${index===plan.steps.length-1&&academy.mode==='partial'?'<span class="subline-inline">the composition — finish it yourself</span>':''}<button type="button" class="secondary-btn" data-academy-check>Check</button></div>`;
  return `<div class="academy-step"><span class="prompt">${esc(step.prompt)}</span><span class="reveal-muted">= ?</span></div>`;
}
function academyHtml(lesson){
  const open=academy.lessonId===lesson.id;
  const toggle=`<div class="academy-actions"><button type="button" class="secondary-btn" data-academy-open="${esc(lesson.id)}">${open?'Hide practice':'Practice step by step'} <span aria-hidden="true">↗</span></button></div>`;
  if(!open)return toggle;
  const plan=academyPlan();
  if(!plan)return `${toggle}<div class="academy"><p class="secondary">No practice plan for this problem right now — its operands are outside the technique's rehearsed range. Use the card example or draw a new problem.</p></div>`;
  const ask=askPlan(plan,academy.mode);
  const canDrill=guideDrillTarget(lesson.id,plan.a,plan.b);
  const chips=GUIDE_MODES.map(m=>`<button type="button" class="chip ${m===academy.mode?'selected':''}" data-academy-mode="${m}" data-academy-chip-lesson="${esc(lesson.id)}">${ACADEMY_MODE_LABELS[m]}</button>`).join('');
  const rows=academy.mode==='independent'?'':plan.steps.map((step,i)=>academyStepRow(step,i,ask,plan)).join('');
  const target=academyInputTarget(plan,ask);
  const resultLine=academy.done?`<div class="academy-step academy-complete"><span>✓ ${esc(plan.result)} — the steps compose to the card's answer.</span></div>`
    :`<div class="academy-step" id="academy-message" aria-live="polite">${academy.message?esc(academy.message):''}</div>`;
  // Guided/partial modes answer inside the step rows above; only 'independent' needs its own field.
  const standaloneInput=!ask.showSteps&&!academy.done&&target?`<div class="academy-actions"><input id="academy-answer" type="text" inputmode="numeric" autocomplete="off" maxlength="${MAX_FIELD}" placeholder="?" aria-label="answer for ${esc(target.prompt)}"><button type="button" class="secondary-btn" data-academy-check>Check</button></div>`:'';
  return `${toggle}
    <div class="academy">
      ${chips?`<div class="academy-mode">${chips}</div><p class="academy-note">Switching modes restarts this problem's rehearsal.</p>`:''}
      <div class="academy-problem">${esc(plan.problemText)}${academy.transfer&&academy.seed?`<code>seed ${esc(academy.seed)}</code>`:''}</div>
      ${rows}
      ${academy.mode==='independent'&&!academy.done?`<p class="academy-note">On your own: no worked steps are shown. Enter the full answer straight away.</p>`:''}
      ${standaloneInput}
      ${resultLine}
      <div class="academy-actions">
        <button type="button" class="secondary-btn" data-academy-transfer="${esc(lesson.id)}">New problem <span aria-hidden="true">↗</span></button>
        ${canDrill?`<button type="button" class="secondary-btn" data-academy-drill>Drill this pattern · 60 s <span aria-hidden="true">↗</span></button>`:ACADEMY_NO_DRILL[lesson.id]?`<span class="academy-note">${esc(ACADEMY_NO_DRILL[lesson.id])}</span>`:''}
      </div>
      <p class="academy-note">Untimed and unscored: the practice run never counts as a benchmark and nothing in this panel is saved. The 60-second drill is a separate practice run on the same operand pattern.</p>
    </div>`;
}
let lessonFilter='all';
function renderLessons(filter) {
  if(filter!==undefined)lessonFilter=filter;
  const list=lessonFilter==='all'?LESSONS:LESSONS.filter(l=>l.operation===lessonFilter);
  $('#lessons').innerHTML=list.map(l=>{
    // Every Academy card — addition, subtraction, multiplication and division (F26) — rehearses:
    // guided, partial and independent modes with exact deterministic checking and transfer draws.
    const guided=GUIDE_LESSON_IDS.includes(l.id);
    const practice=guided?academyHtml(l):'<p class="academy-note">This card has no step plan yet — it stays a worked example.</p>';
    return `<article class="lesson-card"><div class="eyebrow">${esc(opNames[l.operation])}</div><h3>${esc(l.title)}</h3><div class="lesson-equation">${esc(l.example)}</div><ol>${l.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol><strong>Answer: ${l.result}</strong>${practice}</article>`;
  }).join('');
  bindAcademy($('#lessons'));
  if(academy.lessonId)$('#academy-answer')?.focus();
}
function bindAcademy(root){
  root.querySelectorAll('[data-academy-open]').forEach(b=>b.addEventListener('click',()=>academyToggle(b.dataset.academyOpen)));
  root.querySelectorAll('[data-academy-mode]').forEach(b=>b.addEventListener('click',()=>academyMode(b.dataset.academyChipLesson,b.dataset.academyMode)));
  root.querySelectorAll('[data-academy-transfer]').forEach(b=>b.addEventListener('click',()=>academyTransfer(b.dataset.academyTransfer)));
  root.querySelectorAll('[data-academy-check]').forEach(b=>b.addEventListener('click',()=>academyCheck($('#academy-answer')?.value??'')));
  root.querySelectorAll('#academy-answer').forEach(input=>{
    input.addEventListener('keydown',e=>{if(e.key==='Enter')academyCheck(input.value);});
    input.addEventListener('input',()=>{if(academy.message){academy.message='';const live=$('#academy-message');if(live)live.textContent='';}});
  });
  root.querySelectorAll('[data-academy-drill]').forEach(b=>b.addEventListener('click',()=>{
    const plan=academyPlan();if(!plan||!academy.lessonId)return;
    const cell=guideDrillTarget(academy.lessonId,plan.a,plan.b);
    if(!cell){if(ACADEMY_NO_DRILL[academy.lessonId])alert(ACADEMY_NO_DRILL[academy.lessonId]);return;}
    setView('train');showIdle();
    // Lesson hand-offs are their own training surface — tagged honestly, no policy attribution.
    startGame({drill:{...cell},provenance:{surface:'academy',cellId:cell.id??cell.label}});
  }));
}
function renderRoadmap(){
  const phases=[
    {title:'01 / Foundation — Working',state:'INCLUDED',description:'Runnable arithmetic trainer, strict benchmark, seed control, telemetry, local sessions, analytics, adaptive drill weighting, replay, progress history and curriculum examples.',items:['Question generation + inverse operations','Full 120s scoring and safeguards','Local-first persistence and JSON/CSV exports','Adaptive operation focus and daily plan']},
    {title:'02 / Learning Engine',state:'NEXT',description:'Deep skill taxonomy, calibrated mastery, spaced review integration, technique practice, adaptive difficulty, fatigue and precision analysis.',items:['Pattern and fact repetition','Skill mastery estimates with confidence','Interleaving and interval programs','Outcome-tested priority optimization']},
    {title:'03 / Training Laboratory',state:'PLANNED',description:'Input timing calibration, strategy A/B experiments, enhanced heatmaps, plateau interventions and realistic progress estimates.',items:['Keyboard hardware calibration','Strategy comparison experiment runner','Coverage-aware heatmaps','Statistically validated intervention reports']},
    {title:'04 / Quant + Community',state:'PLANNED',description:'Separate quant-format exercises, historical 80-in-8 mode, optional AI explanations and opt-in multiplayer services.',items:['Fractions, EV, percentages, markets','Quant-specific score namespace','Anonymous verified rankings / friends','Optional cloud API, privacy controls']},
  ];
  $('#roadmap-root').innerHTML=`<div class="roadmap-grid">${phases.map(x=>`<article class="roadmap-card"><div class="eyebrow">${x.state}</div><h2>${x.title}</h2><p>${esc(x.description)}</p><ul>${x.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></article>`).join('')}</div><p class="secondary">All 55 proposed features have traceable IDs and acceptance criteria in <code>specs/features.json</code> and <code>docs/FEATURE_MATRIX.md</code>. Detailed agent execution plan: <code>docs/MILESTONES.md</code>.</p>`;
}
// Hardware calibration modal (F40, M4)
function openCalibrationModal() {
  calibState = {
    step: 'intro',
    trials: [],
    index: 0,
    trialStartedAt: 0,
    results: [],
  };
  renderCalibrationModal();
  const modal = $('#calibration-modal');
  if (modal?.showModal) modal.showModal();
}

function closeCalibrationModal() {
  const modal = $('#calibration-modal');
  if (modal?.close) modal.close();
}

function startCalibrationTrials() {
  const seed = crypto.randomUUID();
  calibState.trials = generateCopyTrials(seed, 10);
  calibState.index = 0;
  calibState.results = [];
  calibState.step = 'trial';
  renderCalibrationModal();
  focusCalibrationInput();
}

function focusCalibrationInput() {
  calibState.trialStartedAt = performance.now();
  const input = $('#calib-input');
  if (input) {
    input.value = '';
    input.focus();
  }
}

function submitCalibrationTrial(typedValue) {
  if (calibState.step !== 'trial') return;
  const currentTrial = calibState.trials[calibState.index];
  if (!currentTrial) return;
  const elapsedMs = Math.max(0, performance.now() - calibState.trialStartedAt);
  const evalResult = evaluateCopyTrial(currentTrial, typedValue, elapsedMs);
  calibState.results.push(evalResult);

  calibState.index++;
  if (calibState.index >= calibState.trials.length) {
    calibState.step = 'results';
    renderCalibrationModal();
  } else {
    renderCalibrationModal();
    focusCalibrationInput();
  }
}

function renderCalibrationModal() {
  const body = $('#calib-body');
  if (!body) return;

  if (calibState.step === 'intro') {
    let prevText = '';
    try {
      const stored = localStorage.getItem('zetamaster-calibration');
      if (stored) {
        const p = JSON.parse(stored);
        prevText = `<p class="secondary" style="margin-top:10px">Saved calibration: <strong>${p.medianMs.toFixed(0)} ms</strong> median latency · ${p.msPerDigit ? `${p.msPerDigit} ms/digit · ` : ''}${Math.round(p.accuracy * 100)}% accuracy (${p.sampleSize} trials).</p>`;
      }
    } catch {}

    body.innerHTML = `
      <p class="secondary">Isolate keyboard and motor latency from mental calculation time. You will copy 10 random numbers (1 to 4 digits) matching arithmetic answer profiles as fast as you can.</p>
      ${prevText}
      <p class="small muted">Answers submit automatically when correct, or press Enter. Each trial measures raw entry speed from prompt display to completion.</p>
      <div class="calib-btn-row">
        <button type="button" class="primary-btn" id="calib-start-btn">Start calibration (10 trials) ↗</button>
      </div>
    `;
    $('#calib-start-btn')?.addEventListener('click', startCalibrationTrials);
  } else if (calibState.step === 'trial') {
    const trial = calibState.trials[calibState.index];
    body.innerHTML = `
      <div class="calib-meta">Trial ${calibState.index + 1} of ${calibState.trials.length} · ${trial.digits} digit${trial.digits === 1 ? '' : 's'}</div>
      <div class="calib-prompt" id="calib-prompt-text">${esc(trial.prompt)}</div>
      <input type="text" id="calib-input" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="Copy number" pattern="[0-9]*" autofocus>
      <p class="small muted" style="text-align:center">Type the exact digits shown above. Submits automatically when complete.</p>
    `;
    const input = $('#calib-input');
    if (input) {
      input.addEventListener('input', e => {
        if (e.target.value.trim() === trial.expected) {
          submitCalibrationTrial(e.target.value);
        }
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitCalibrationTrial(input.value);
        }
      });
    }
  } else if (calibState.step === 'results') {
    const diag = computeHardwareDiagnostics(calibState.results);
    if (diag) {
      try {
        localStorage.setItem('zetamaster-calibration', JSON.stringify(diag));
      } catch {}
    }
    const tile = (label, value, note) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small class="tile-note">${note}</small></div>`;
    body.innerHTML = `
      <div class="stat-grid consistency-tiles" style="margin-top:10px">
        ${tile('MEDIAN LATENCY', diag ? `${diag.medianMs.toFixed(0)} ms` : '—', 'Hardware typing overhead')}
        ${tile('SPREAD (P10–P90)', diag ? `${diag.p10Ms.toFixed(0)}–${diag.p90Ms.toFixed(0)} ms` : '—', 'Execution consistency')}
        ${tile('ENTRY RATE', diag && diag.msPerDigit ? `${diag.msPerDigit} ms/digit` : '—', 'Per-character speed')}
        ${tile('ACCURACY', diag ? `${Math.round(diag.accuracy * 100)}%` : '—', `${diag?.correctCount ?? 0} / ${diag?.sampleSize ?? 0} correct`)}
      </div>
      <p class="secondary">Your measured keyboard overhead is approximately <strong>${diag?.medianMs.toFixed(0) ?? '—'} ms</strong> per number. This baseline isolates motor entry from cognitive calculation time.</p>
      <p class="small muted">${esc(diag?.limitation ?? '')}</p>
      <div class="calib-btn-row">
        <button type="button" class="secondary-btn" id="calib-retry-btn">Recalibrate ↗</button>
        <button type="button" class="primary-btn" id="calib-done-btn">Done</button>
      </div>
    `;
    $('#calib-retry-btn')?.addEventListener('click', startCalibrationTrials);
    $('#calib-done-btn')?.addEventListener('click', closeCalibrationModal);
    renderEntry();
  }
}


function renderCommunity() {
  const root = $('#community-root');
  if (!root) return;
  const rankEval = evaluateBenchmarkRank(sessions);
  const practiceStats = evaluatePracticeActivity(sessions);
  const achEval = evaluateAchievements(sessions, { skillReviews });
  const consent = readLeaderboardConsent(localStorage);
  const currentAlias = localStorage.getItem('zetamaster-player-alias-v1') || '';
  const leaderboardEntries = defaultLeaderboardStore.getEntries(20);

  const rank = rankEval.rank;
  const rankHtml = `
    <div class="panel community-full">
      <div class="section-header">
        <div>
          <div class="eyebrow">SUSTAINED VERIFIED BENCHMARK RANK · F44</div>
          <h2 class="section-title">Verified Benchmark Standing</h2>
        </div>
        <span class="tag">${rankEval.calibrated ? 'CALIBRATED' : 'CALIBRATING'}</span>
      </div>
      <div class="rank-badge-display">
        <div class="rank-badge-icon">${rank.badge}</div>
        <div>
          <div class="rank-badge-title">${esc(rank.title)}</div>
          <div class="rank-badge-desc">${esc(rank.description)}</div>
        </div>
      </div>
      <div class="rank-stats-row">
        <div class="rank-stat">
          <div class="rank-stat-label">Sustained Median</div>
          <div class="rank-stat-val">${rankEval.sustainedScore !== null ? rankEval.sustainedScore : '—'}</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Verified Runs</div>
          <div class="rank-stat-val">${rankEval.verifiedCount} <small style="font-size:12px;color:var(--muted)">/ ${rankEval.minRequired}</small></div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Stability (IQR)</div>
          <div class="rank-stat-val">${rankEval.stability ? '±' + rankEval.stability.iqr : '—'}</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Next Rank</div>
          <div class="rank-stat-val">${rankEval.nextRank ? esc(rankEval.nextRank.title) + ' (+' + rankEval.pointsToNext + ')' : 'MAX TIER'}</div>
        </div>
      </div>
      <p class="small muted">${esc(rankEval.isolationNotice)} Practice runs: ${practiceStats.sessionsCount} (${practiceStats.totalSolves} solves) tracked separately.</p>
    </div>
  `;

  const challengeHtml = `
    <div class="panel">
      <div class="section-header">
        <div>
          <div class="eyebrow">HEAD-TO-HEAD CHALLENGES · F47</div>
          <h2 class="section-title">Challenge Sharing</h2>
        </div>
        <span class="tag">ZERO PII</span>
      </div>
      <p class="secondary">Share reproducible, tamper-proof challenge links containing only seed and ruleset. Links contain zero personal identifiers or telemetry.</p>
      <div class="challenge-controls">
        <label class="field">
          <span>CHALLENGE SEED</span>
          <div style="display:flex;gap:8px;">
            <input type="text" id="ch-seed-input" value="ch-${Date.now().toString(36)}" style="flex:1;">
            <button type="button" class="secondary-btn" id="ch-rand-seed-btn">🎲 Random</button>
          </div>
        </label>
        <div class="field-row">
          <label class="field">
            <span>DURATION</span>
            <select id="ch-duration-select">
              <option value="30">30s sprint</option>
              <option value="60">60s test</option>
              <option value="120" selected>120s standard</option>
              <option value="300">300s marathon</option>
            </select>
          </label>
          <label class="field">
            <span>QUESTION BUDGET</span>
            <select id="ch-budget-select">
              <option value="" selected>Unlimited (standard)</option>
              <option value="2000">2000ms (automaticity)</option>
              <option value="3000">3000ms (pace)</option>
            </select>
          </label>
        </div>
        <button type="button" class="primary-btn" id="ch-generate-btn">Generate Challenge URL ↗</button>
        <div class="copy-row" id="ch-url-row" style="display:none;">
          <input type="text" id="ch-url-output" readonly>
          <button type="button" class="secondary-btn" id="ch-copy-btn">📋 Copy</button>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px;">
          <label class="field">
            <span>LOAD CHALLENGE LINK OR TOKEN</span>
            <div style="display:flex;gap:8px;">
              <input type="text" id="ch-import-input" placeholder="Paste #challenge=zmch_... token">
              <button type="button" class="secondary-btn" id="ch-import-btn">Load</button>
            </div>
          </label>
        </div>
      </div>
    </div>
  `;

  const consentChecked = consent.enabled ? 'checked' : '';
  const entriesRows = leaderboardEntries.length
    ? leaderboardEntries.map(e => `
        <tr>
          <td class="rank-cell">#${e.rank}</td>
          <td><strong>${esc(e.alias)}</strong></td>
          <td><strong>${e.score}</strong></td>
          <td>${e.meanLatencyMs}ms</td>
          <td><small class="muted">${new Date(e.verifiedAt).toLocaleDateString()}</small></td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="empty" style="text-align:center;padding:16px;">No verified scores submitted yet.</td></tr>';

  const leaderboardHtml = `
    <div class="panel">
      <div class="section-header">
        <div>
          <div class="eyebrow">GLOBAL LEADERBOARDS · F46</div>
          <h2 class="section-title">Verified Leaderboard</h2>
        </div>
        <span class="tag">${consent.enabled ? 'OPTED-IN' : 'OFFLINE'}</span>
      </div>
      <div class="consent-banner">
        <label class="consent-toggle-row">
          <input type="checkbox" id="lb-consent-toggle" ${consentChecked}>
          <span><strong>Opt in to Global Leaderboard</strong> (Disabled by default)</span>
        </label>
        <p class="small muted" style="margin-top:6px;">When enabled, you can submit verified benchmark scores. Submissions are checked draw-for-draw against deterministic replay and human reaction bounds. No PII is collected.</p>
      </div>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:14px;flex-wrap:wrap;">
        <label class="field inline" style="flex:1;min-width:180px;">
          <span>PLAYER ALIAS (NO PII)</span>
          <input type="text" id="lb-alias-input" value="${esc(currentAlias)}" placeholder="e.g. SpeedCalc99" maxlength="20">
        </label>
        <button type="button" class="primary-btn" id="lb-submit-latest-btn" ${consent.enabled ? '' : 'disabled'}>Submit Latest Benchmark ↗</button>
      </div>
      <div id="lb-status-msg" style="font-size:12px;margin-bottom:8px;"></div>
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player Alias</th>
            <th>Score</th>
            <th>Avg Latency</th>
            <th>Verified Date</th>
          </tr>
        </thead>
        <tbody>
          ${entriesRows}
        </tbody>
      </table>
      <div class="subline" style="margin-top:12px;">
        <button type="button" class="text-btn" id="lb-clear-btn">Clear local cache / forget entries</button>
      </div>
    </div>
  `;

  const achCards = achEval.achievements.map(a => `
    <div class="achievement-card ${a.unlocked ? 'unlocked' : 'locked'}">
      <div>
        <div class="ach-header">
          <div class="ach-icon">${a.icon}</div>
          <div style="flex:1;">
            <div class="ach-title">${esc(a.title)}</div>
            <span class="ach-tag ${a.unlocked ? 'ach-unlocked-tag' : 'ach-locked-tag'}">${a.unlocked ? 'Unlocked' : 'Locked'}</span>
          </div>
        </div>
        <div class="ach-desc">${esc(a.description)}</div>
      </div>
      <div>
        <div class="ach-progress-bar">
          <div class="ach-progress-fill" style="width:${Math.round(a.progress * 100)}%;"></div>
        </div>
        <div class="ach-meta">
          ${a.unlocked
            ? `Completed ${a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString() : ''}`
            : `Progress: ${Math.round(a.current)} / ${a.target}`
          }
        </div>
      </div>
    </div>
  `).join('');

  const achievementsHtml = `
    <div class="panel community-full">
      <div class="section-header">
        <div>
          <div class="eyebrow">SKILL-BASED ACHIEVEMENTS · F45</div>
          <h2 class="section-title">Mastery Achievements</h2>
        </div>
        <span class="tag">${achEval.totalUnlocked} / ${achEval.totalAchievements} UNLOCKED (${achEval.completionPercentage}%)</span>
      </div>
      <p class="secondary">${esc(achEval.antiCompulsiveNotice)}</p>
      <div class="achievements-grid">
        ${achCards}
      </div>
    </div>
  `;

  root.innerHTML = `
    <div class="community-grid">
      ${rankHtml}
      ${challengeHtml}
      ${leaderboardHtml}
      ${achievementsHtml}
    </div>
  `;

  $('#ch-rand-seed-btn')?.addEventListener('click', () => {
    $('#ch-seed-input').value = 'ch-' + Math.random().toString(36).slice(2, 8);
  });

  $('#ch-generate-btn')?.addEventListener('click', () => {
    try {
      const seed = $('#ch-seed-input').value.trim() || 'default-ch-seed';
      const durationSeconds = Number($('#ch-duration-select').value) || 120;
      const budgetVal = $('#ch-budget-select').value;
      const questionBudgetMs = budgetVal ? Number(budgetVal) : undefined;

      const url = buildChallengeUrl(location.origin + location.pathname, {
        seed,
        durationSeconds,
        questionBudgetMs,
      });

      $('#ch-url-output').value = url;
      $('#ch-url-row').style.display = 'flex';
    } catch (err) {
      alert('Failed to generate challenge: ' + err.message);
    }
  });

  $('#ch-copy-btn')?.addEventListener('click', () => {
    const output = $('#ch-url-output');
    output.select();
    navigator.clipboard?.writeText?.(output.value);
    $('#ch-copy-btn').textContent = '✓ Copied!';
    setTimeout(() => { $('#ch-copy-btn').textContent = '📋 Copy'; }, 2000);
  });

  $('#ch-import-btn')?.addEventListener('click', () => {
    const raw = $('#ch-import-input').value.trim();
    if (!raw) return;
    try {
      const decoded = parseChallengeFromUrl(raw);
      if (!decoded) throw new Error('Unrecognized challenge format');
      openChallengeModal(decoded);
    } catch (err) {
      alert('Could not load challenge: ' + err.message);
    }
  });

  $('#lb-consent-toggle')?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    setLeaderboardConsent(localStorage, enabled, new Date().toISOString());
    renderCommunity();
  });

  $('#lb-alias-input')?.addEventListener('change', (e) => {
    try {
      const sanitized = sanitizeAlias(e.target.value);
      localStorage.setItem('zetamaster-player-alias-v1', sanitized);
      e.target.value = sanitized;
    } catch (err) {
      alert('Invalid handle: ' + err.message);
      e.target.value = localStorage.getItem('zetamaster-player-alias-v1') || '';
    }
  });

  $('#lb-submit-latest-btn')?.addEventListener('click', () => {
    const statusMsg = $('#lb-status-msg');
    try {
      const alias = $('#lb-alias-input').value.trim();
      if (!alias) {
        statusMsg.innerHTML = '<span style="color:#fb8c78">Please enter a player alias.</span>';
        return;
      }
      const verifiedBenchmarks = sessions.filter(
        s => s && s.benchmark === true && s.mode === 'benchmark' && s.elapsedMs >= 120000
      );
      if (!verifiedBenchmarks.length) {
        statusMsg.innerHTML = '<span style="color:#fb8c78">No completed 120s benchmark found to submit.</span>';
        return;
      }
      const latest = verifiedBenchmarks[verifiedBenchmarks.length - 1];
      const res = submitLeaderboardScore({
        session: latest,
        alias,
        consent: readLeaderboardConsent(localStorage),
        now: new Date().toISOString(),
      });
      statusMsg.innerHTML = `<span style="color:#6ee7b7">✓ Score ${res.entry.score} verified! Ranked #${res.rank} of ${res.totalEntries}.</span>`;
      renderCommunity();
    } catch (err) {
      statusMsg.innerHTML = `<span style="color:#fb8c78">Submission failed: ${esc(err.message)}</span>`;
    }
  });

  $('#lb-clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear local leaderboard cache and forget stored alias?')) {
      defaultLeaderboardStore.clear();
      localStorage.removeItem('zetamaster-player-alias-v1');
      renderCommunity();
    }
  });
}

function openChallengeModal(challenge) {
  const modal = $('#challenge-modal');
  const body = $('#challenge-modal-body');
  if (!modal || !body) return;

  const opsList = (challenge.rules.enabled || []).map(o => opNames[o] || o).join(', ');
  body.innerHTML = `
    <div style="padding:10px 0;">
      <p class="secondary">You received an arithmetic challenge with a pinned seed and ruleset. Both players face the exact same problem sequence.</p>
      <div class="rank-stats-row" style="margin:16px 0;">
        <div class="rank-stat">
          <div class="rank-stat-label">Seed</div>
          <div class="rank-stat-val" style="font-size:14px;word-break:break-all;">${esc(challenge.seed)}</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Duration</div>
          <div class="rank-stat-val">${challenge.rules.durationSeconds}s</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Operations</div>
          <div class="rank-stat-val" style="font-size:14px;">${esc(opsList)}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
        <button type="button" class="secondary-btn" id="ch-modal-cancel">Decline</button>
        <button type="button" class="primary-btn" id="ch-modal-accept">Accept & Start Challenge ↗</button>
      </div>
    </div>
  `;

  $('#ch-modal-cancel')?.addEventListener('click', () => modal.close());
  $('#ch-modal-accept')?.addEventListener('click', () => {
    modal.close();
    setView('train');
    showIdle();
    startGame({
      preset: {
        rules: challenge.rules,
        seed: challenge.seed,
        mode: 'custom',
      },
    });
  });

  modal.showModal();
}

function checkUrlChallenge() {
  try {
    const challenge = parseChallengeFromUrl(location.href);
    if (challenge) {
      openChallengeModal(challenge);
    }
  } catch (err) {
    console.warn('Could not parse challenge from URL', err);
  }
}

function renderQuant() {
  renderQuantUI({
    root: $('#quant-root'),
    sessions,
    onStartGame: ({ preset }) => {
      setView('train');
      showIdle();
      startGame({ preset });
    },
  });
}
function bind(){
  $$('.nav-link').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
  $('#brand').addEventListener('click',e=>{e.preventDefault();setView('train');});
  $('#mode').addEventListener('change',updateMode);
  $('#start').addEventListener('click',()=>startGame());
  $('#adaptive-quick').addEventListener('click',()=>{$('#mode').value='adaptive';updateMode();startGame();});
  $('#answer').addEventListener('input',answerInput);
  $('#answer').addEventListener('keydown',e=>{if(e.key==='Enter'&&currentSession?.state==='active'){currentSession.markWrongSubmission();e.preventDefault();}});
  document.addEventListener('visibilitychange',()=>{currentSession?.recordVisibility(document.hidden);if(!document.hidden)renderTick();});
  $('#finish').addEventListener('click',()=>finishGame(true));
  $('#again').addEventListener('click',()=>{
    showIdle();
    // "Play again" re-launches the last launch vehicle verbatim (same rules, same seed, same drill,
    // same provenance context). A benchmark or replay rebuild doesn't re-tag on its own: replays
    // re-execute an old run, and a mode-picker benchmark launch never carries a treatment tag.
    if(lastLaunch)startGame(lastLaunch);
    else startGame();
  });
  $('#analyze-result').addEventListener('click',()=>{showIdle();setView('analytics');});
  $('#open-calibration')?.addEventListener('click',openCalibrationModal);
  $('#calib-close')?.addEventListener('click',closeCalibrationModal);
  $('#calibration-modal')?.addEventListener('cancel',closeCalibrationModal);
  $('#challenge-modal-close')?.addEventListener('click',()=>$('#challenge-modal')?.close());
  $('#challenge-modal')?.addEventListener('cancel',()=>$('#challenge-modal')?.close());
  // Entry settings (F05): persisted toggles feeding the shared answer path and cosmetic sounds.
  entrySettings=readEntrySettings(localStorage);
  $('#setting-keypad')?.addEventListener('change',e=>{entrySettings=writeEntrySettings(localStorage,{...entrySettings,keypad:e.target.checked});});
  $('#setting-sound')?.addEventListener('change',e=>{entrySettings=writeEntrySettings(localStorage,{...entrySettings,sound:e.target.checked});soundCue('correct');});
  $('#setting-keypad').checked=entrySettings.keypad;
  $('#setting-sound').checked=entrySettings.sound;
  prefillCustomRanges();
  renderKeypad();
  // Academy close-out surfaces (F26–F29): division cards rehearse above; the strategy duel and
  // the pasted-explanation verifier live beside them, both unscored and unconnected.
  renderDuelUI({root:$('#duel-panel')});
  renderCoachUI({root:$('#coach-panel')});
  $$('#lesson-filters button').forEach(button=>button.addEventListener('click',()=>{$$('#lesson-filters button').forEach(b=>b.classList.toggle('selected',b===button));renderLessons(button.dataset.op);}));
}
bind();updateMode();renderLessons();renderRoadmap();renderCommunity();renderQuant();checkUrlChallenge();applyHeatmapHash();refresh().catch(error=>console.error('History loading failed',error));
if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('Offline registration unavailable',error));
