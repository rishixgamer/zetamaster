/**
 * Quant Academy UI & Interactive Training Sandboxes (Milestone M6, F49–F55).
 * Modular view controller for exact fractions, probability, finance, estimation,
 * stateful running arithmetic, historical 80-in-8, and market-making simulations.
 */
import { createFractionGenerator, evaluateFractionAnswer, FRACTION_OPS } from '../../../packages/quant/src/fractions.js';
import { createProbabilityGenerator, evaluateProbabilityAnswer, PROBABILITY_TYPES } from '../../../packages/quant/src/probability.js';
import { createFinanceGenerator, evaluateFinanceAnswer, FINANCE_TYPES } from '../../../packages/quant/src/finance.js';
import { createEstimationGenerator, evaluateEstimate, ESTIMATION_TYPES } from '../../../packages/quant/src/estimation.js';
import { generateRunningChain, evaluateRunningStep } from '../../../packages/quant/src/running.js';
import { HISTORICAL_80_IN_8_RULES, createHistorical80in8Generator, evaluateHistorical80in8Session } from '../../../packages/quant/src/historical.js';
import { createMarketScenario, validateMarketQuote, simulateMarketRound, aggregateMarketPerformance } from '../../../packages/quant/src/market-making.js';
import { summarizeQuantProgress } from '../../../packages/quant/src/scoring.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Local reactive state for interactive cards
let activeCategory = 'all';

let fracGen = createFractionGenerator('quant-frac-init');
let currentFrac = fracGen();
let fracFeedback = null;

let probGen = createProbabilityGenerator('quant-prob-init');
let currentProb = probGen();
let probFeedback = null;

let finGen = createFinanceGenerator('quant-fin-init');
let currentFin = finGen();
let finFeedback = null;

let estGen = createEstimationGenerator('quant-est-init');
let currentEst = estGen();
let estFeedback = null;

let runningSeedCounter = 1;
let currentChain = generateRunningChain({ length: 5, seed: 'running-seed-1' });
let runningStepIdx = 0;
let runningFeedback = null;

let mmSeedCounter = 1;
let currentMMScenario = createMarketScenario('mm-seed-1');
let mmRounds = [];
let mmFeedback = null;

export function renderQuantUI({ root, sessions = [], onStartGame = () => {} }) {
  if (!root) return;

  const quantProgress = summarizeQuantProgress(sessions);
  const mmAgg = aggregateMarketPerformance(mmRounds);

  const categories = [
    { id: 'all', label: 'All Tools' },
    { id: 'fractions', label: 'Fractions (F49)' },
    { id: 'probability', label: 'Probability & EV (F50)' },
    { id: 'finance', label: 'Finance (F51)' },
    { id: 'estimation', label: 'Estimation (F52)' },
    { id: 'running', label: 'Running Memory (F53)' },
    { id: 'historical', label: '80-in-8 (F54)' },
    { id: 'market-making', label: 'Market Making (F55)' },
  ];

  const chipsHtml = `
    <div class="lesson-filters" id="quant-category-filters" style="margin-bottom:18px;">
      ${categories.map(c => `<button type="button" class="chip ${c.id === activeCategory ? 'selected' : ''}" data-quant-cat="${c.id}">${c.label}</button>`).join('')}
    </div>
  `;

  const isolationBanner = `
    <div class="isolation-banner">
      <span style="font-size:20px;line-height:1;">🔒</span>
      <div>
        <strong>STRICT BENCHMARK ISOLATION GUARANTEED (M6 Gate)</strong><br>
        All Quant Academy exercises, fractions, estimation trials, historical 80-in-8 scores, and market-making PnL are isolated within the <code>quant-practice</code> namespace. Standard Zetamac 120s benchmarks, rolling median, progression ladder, and community ranks remain completely segregated.
      </div>
    </div>
  `;

  const statsStrip = `
    <div class="quant-stat-grid" style="margin-bottom:20px;">
      <div class="quant-stat-tile">
        <span>Quant Runs</span>
        <strong>${quantProgress.totalRuns}</strong>
      </div>
      <div class="quant-stat-tile">
        <span>Problems Solved</span>
        <strong>${quantProgress.totalProblems}</strong>
      </div>
      <div class="quant-stat-tile">
        <span>Historical 80-in-8 PB</span>
        <strong>${quantProgress.historical80in8.bestNetScore !== null ? `${quantProgress.historical80in8.bestNetScore} net` : '—'}</strong>
      </div>
      <div class="quant-stat-tile">
        <span>MM Realized PnL</span>
        <strong>${mmAgg.totalPnl >= 0 ? '+' : ''}$${mmAgg.totalPnl.toFixed(2)}</strong>
      </div>
      <div class="quant-stat-tile">
        <span>MM Win Rate</span>
        <strong>${mmAgg.winRate}%</strong>
      </div>
    </div>
  `;

  // F49: Fractions & Decimals card
  const showFrac = activeCategory === 'all' || activeCategory === 'fractions';
  const fracHtml = showFrac ? `
    <article class="quant-card" id="card-fractions">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">EXACT RATIONAL ARITHMETIC · F49</div>
          <h2 class="section-title">Fractions & Decimals</h2>
        </div>
        <span class="quant-badge quant-badge-green">EXACT RATIONAL</span>
      </div>
      <p class="secondary">Exact rational computation avoiding floating-point drift. Add, subtract, multiply, divide, reduce, and convert between exact fractions and decimals.</p>
      <div class="quant-problem-box">${esc(currentFrac.expression)}</div>
      <div class="quant-input-row">
        <label class="sr-only" for="q-frac-input">Enter fraction answer</label>
        <input id="q-frac-input" type="text" placeholder="e.g. 3/4 or 0.75" autocomplete="off">
        <button type="button" class="primary-btn" id="q-frac-submit">Check ↗</button>
        <button type="button" class="secondary-btn" id="q-frac-next">New Problem</button>
      </div>
      ${fracFeedback ? `<div class="quant-feedback ${fracFeedback.correct ? 'correct' : 'incorrect'}">${fracFeedback.correct ? '✓ ' : '✗ '}${esc(fracFeedback.explanation)}</div>` : ''}
    </article>
  ` : '';

  // F50: Probability & Combinatorics card
  const showProb = activeCategory === 'all' || activeCategory === 'probability';
  const probHtml = showProb ? `
    <article class="quant-card" id="card-probability">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">PROBABILITY ARITHMETIC & EV · F50</div>
          <h2 class="section-title">Probability & Combinatorics</h2>
        </div>
        <span class="quant-badge quant-badge-blue">VERIFIED BANK</span>
      </div>
      <p class="secondary">Permutations P(n, r), combinations C(n, r), dice roll sums, coin toss sequences, and expected value payoffs.</p>
      <div class="quant-problem-box">${esc(currentProb.expression)}</div>
      <div class="quant-input-row">
        <label class="sr-only" for="q-prob-input">Enter probability answer</label>
        <input id="q-prob-input" type="text" placeholder="e.g. 35, 5/36, or 2.50" autocomplete="off">
        <button type="button" class="primary-btn" id="q-prob-submit">Check ↗</button>
        <button type="button" class="secondary-btn" id="q-prob-next">New Problem</button>
      </div>
      ${probFeedback ? `<div class="quant-feedback ${probFeedback.correct ? 'correct' : 'incorrect'}">${probFeedback.correct ? '✓ ' : '✗ '}${esc(probFeedback.explanation)}</div>` : ''}
    </article>
  ` : '';

  // F51: Percentages & Finance card
  const showFin = activeCategory === 'all' || activeCategory === 'finance';
  const finHtml = showFin ? `
    <article class="quant-card" id="card-finance">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">PERCENTAGES & FINANCIAL MATH · F51</div>
          <h2 class="section-title">Percentages & Financial Math</h2>
        </div>
        <span class="quant-badge quant-badge-gold">FINANCE</span>
      </div>
      <p class="secondary">Basis points conversions (100 bps = 1%), percentage changes, markup vs margin, simple interest, and Rule of 72.</p>
      <div class="quant-problem-box">${esc(currentFin.expression)}</div>
      <div class="quant-input-row">
        <label class="sr-only" for="q-fin-input">Enter finance answer</label>
        <input id="q-fin-input" type="text" placeholder="e.g. 25, 125, or 180" autocomplete="off">
        <button type="button" class="primary-btn" id="q-fin-submit">Check ↗</button>
        <button type="button" class="secondary-btn" id="q-fin-next">New Problem</button>
      </div>
      ${finFeedback ? `<div class="quant-feedback ${finFeedback.correct ? 'correct' : 'incorrect'}">${finFeedback.correct ? '✓ ' : '✗ '}${esc(finFeedback.explanation)}</div>` : ''}
    </article>
  ` : '';

  // F52: Estimation & Numerical Bounds card
  const showEst = activeCategory === 'all' || activeCategory === 'estimation';
  const estHtml = showEst ? `
    <article class="quant-card" id="card-estimation">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">RANGE-BASED ESTIMATION · F52</div>
          <h2 class="section-title">Estimation & Numerical Bounds</h2>
        </div>
        <span class="quant-badge quant-badge-green">TOLERANCE ±${Math.round(currentEst.tolerance * 100)}%</span>
      </div>
      <p class="secondary">Quick Fermi and order-of-magnitude estimates. Your answer is evaluated against deterministic mathematical bounds with full step-by-step justification.</p>
      <div class="quant-problem-box">${esc(currentEst.expression)}</div>
      <div class="quant-input-row">
        <label class="sr-only" for="q-est-input">Enter your numerical estimate</label>
        <input id="q-est-input" type="text" placeholder="Your numerical estimate" autocomplete="off">
        <button type="button" class="primary-btn" id="q-est-submit">Evaluate Estimate ↗</button>
        <button type="button" class="secondary-btn" id="q-est-next">New Estimate</button>
      </div>
      ${estFeedback ? `<div class="quant-feedback ${estFeedback.correct ? 'correct' : 'incorrect'}">${estFeedback.correct ? '✓ ' : '✗ '}${esc(estFeedback.explanation)}</div>` : ''}
    </article>
  ` : '';

  // F53: Stateful Running Arithmetic card
  const showRunning = activeCategory === 'all' || activeCategory === 'running';
  const currentStep = currentChain.steps[runningStepIdx];
  const isChainDone = runningStepIdx >= currentChain.steps.length;
  const runningHtml = showRunning ? `
    <article class="quant-card" id="card-running">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">STATEFUL RUNNING ARITHMETIC · F53</div>
          <h2 class="section-title">Running Mental Memory</h2>
        </div>
        <span class="quant-badge quant-badge-blue">STEP ${isChainDone ? currentChain.steps.length : runningStepIdx + 1} OF ${currentChain.steps.length}</span>
      </div>
      <p class="secondary">Accumulate chained operations in working memory without writing intermediate steps. All divisions are guaranteed exact integers.</p>
      
      <div class="running-steps-track">
        <span class="running-step-item done">Start: ${currentChain.initialValue}</span>
        ${currentChain.steps.map((s, idx) => {
          let cls = '';
          if (idx < runningStepIdx) cls = 'done';
          else if (idx === runningStepIdx && !isChainDone) cls = 'active';
          return `<span class="running-step-item ${cls}">${s.symbol} ${s.operand}</span>`;
        }).join('')}
      </div>

      ${isChainDone ? `
        <div class="quant-problem-box" style="color:var(--accent);">✓ Sequence Complete! Final Total = ${currentChain.finalAnswer}</div>
        <div style="display:flex;gap:10px;">
          <button type="button" class="primary-btn" id="q-run-new">New Sequence ↗</button>
        </div>
      ` : `
        <div class="quant-problem-box">Running total: ${currentStep.prevValue} ${currentStep.symbol} ${currentStep.operand} = ?</div>
        <div class="quant-input-row">
          <label class="sr-only" for="q-run-input">Enter intermediate running total</label>
          <input id="q-run-input" type="text" placeholder="Current total" autocomplete="off">
          <button type="button" class="primary-btn" id="q-run-submit">Submit Step ↗</button>
          <button type="button" class="secondary-btn" id="q-run-new">Reset / New</button>
        </div>
      `}
      ${runningFeedback ? `<div class="quant-feedback ${runningFeedback.correct ? 'correct' : 'incorrect'}">${runningFeedback.correct ? '✓ ' : '✗ '}${esc(runningFeedback.explanation)}</div>` : ''}
    </article>
  ` : '';

  // F54: Historical 80-in-8 Training card
  const showHist = activeCategory === 'all' || activeCategory === 'historical';
  const histHtml = showHist ? `
    <article class="quant-card quant-full" id="card-historical">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">HISTORICAL TRADING TEST · F54</div>
          <h2 class="section-title">Historical 80-in-8 Assessment</h2>
        </div>
        <span class="quant-badge quant-badge-gold">HISTORICAL OPTIVER FORMAT</span>
      </div>
      <p class="secondary">Standardized quant trading interview format: 80 questions in 8 minutes (480 seconds) with negative marking (+1 for correct, −1 for incorrect attempts). Tested separately from Zetamac standard benchmarks with distinct rules and net scoring.</p>
      
      <div class="rank-stats-row">
        <div class="rank-stat">
          <div class="rank-stat-label">Target Questions</div>
          <div class="rank-stat-val">80</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Time Limit</div>
          <div class="rank-stat-val">8:00 (480s)</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Scoring Rule</div>
          <div class="rank-stat-val" style="font-size:16px;">+1 Correct / −1 Wrong</div>
        </div>
        <div class="rank-stat">
          <div class="rank-stat-label">Historical Pass Line</div>
          <div class="rank-stat-val" style="color:var(--accent);">55+ Net</div>
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-top:14px;flex-wrap:wrap;">
        <button type="button" class="primary-btn" id="q-hist-launch">Launch 80-in-8 Session (480s) ↗</button>
      </div>
      <p class="small muted">Historical simulation mode: completely independent from 120s Zetamac benchmarks. Results never count toward the 70+ arithmetic goal or ladder tiers.</p>
    </article>
  ` : '';

  // F55: Market-Making Expected-Value Simulator card
  const showMM = activeCategory === 'all' || activeCategory === 'market-making';
  const mmHtml = showMM ? `
    <article class="quant-card quant-full" id="card-market-making">
      <div class="quant-card-head">
        <div>
          <div class="eyebrow">EXPECTED-VALUE QUOTING SIMULATOR · F55</div>
          <h2 class="section-title">Market-Making Simulator</h2>
        </div>
        <span class="quant-badge quant-badge-blue">LIVE QUOTING GAME</span>
      </div>
      <p class="secondary">Quote two-way Bid and Ask markets around an uncertain payoff. Counterparty orders arrive based on fair value plus noise. Manage inventory, capture spread, and evaluate realized PnL upon settlement.</p>
      
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin:10px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <h3 style="margin:0;font-size:18px;color:var(--text);">${esc(currentMMScenario.contractName)}</h3>
          <span class="tag">MAX SPREAD: $${currentMMScenario.maxSpread.toFixed(2)}</span>
        </div>
        <p class="secondary" style="margin:8px 0 12px;">${esc(currentMMScenario.description)}</p>
        <div class="rank-stats-row" style="margin:0;">
          <div class="rank-stat">
            <div class="rank-stat-label">Fair Value (EV)</div>
            <div class="rank-stat-val" style="color:var(--gold);">$${currentMMScenario.fairValue.toFixed(2)}</div>
          </div>
          <div class="rank-stat">
            <div class="rank-stat-label">Possible Payoff Range</div>
            <div class="rank-stat-val">$${currentMMScenario.minPossible} – $${currentMMScenario.maxPossible}</div>
          </div>
        </div>
      </div>

      <div class="quote-inputs-grid">
        <label>
          YOUR BID (You buy at this price):
          <input type="number" step="0.25" id="mm-bid-input" placeholder="Bid" value="${(currentMMScenario.fairValue - currentMMScenario.maxSpread / 2).toFixed(2)}">
        </label>
        <label>
          YOUR ASK (You sell at this price):
          <input type="number" step="0.25" id="mm-ask-input" placeholder="Ask" value="${(currentMMScenario.fairValue + currentMMScenario.maxSpread / 2).toFixed(2)}">
        </label>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" class="primary-btn" id="mm-quote-submit">Submit Quote & Simulate Market ↗</button>
        <button type="button" class="secondary-btn" id="mm-next-scenario">Next Contract Scenario</button>
      </div>

      ${mmFeedback ? `
        <div class="quant-feedback ${mmFeedback.profitable ? 'correct' : 'incorrect'}" style="margin-top:14px;">
          <strong>${mmFeedback.summary}</strong><br>
          Trades: Bought ${mmFeedback.contractsBought} @ $${mmFeedback.bid}, Sold ${mmFeedback.contractsSold} @ $${mmFeedback.ask} · Net position: ${mmFeedback.netPosition} contracts · Captured Edge: $${mmFeedback.capturedEdge.toFixed(2)}.
        </div>
      ` : ''}
    </article>
  ` : '';

  root.innerHTML = `
    ${chipsHtml}
    ${isolationBanner}
    ${statsStrip}
    <div class="quant-grid">
      ${fracHtml}
      ${probHtml}
      ${finHtml}
      ${estHtml}
      ${runningHtml}
      ${histHtml}
      ${mmHtml}
    </div>
  `;

  // Attach event handlers
  root.querySelectorAll('#quant-category-filters button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.quantCat;
      renderQuantUI({ root, sessions, onStartGame });
    });
  });

  // F49 handlers
  $('#q-frac-submit')?.addEventListener('click', () => {
    const input = $('#q-frac-input');
    if (!input) return;
    fracFeedback = evaluateFractionAnswer(input.value, currentFrac);
    renderQuantUI({ root, sessions, onStartGame });
  });
  $('#q-frac-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#q-frac-submit')?.click();
  });
  $('#q-frac-next')?.addEventListener('click', () => {
    currentFrac = fracGen();
    fracFeedback = null;
    renderQuantUI({ root, sessions, onStartGame });
  });

  // F50 handlers
  $('#q-prob-submit')?.addEventListener('click', () => {
    const input = $('#q-prob-input');
    if (!input) return;
    probFeedback = evaluateProbabilityAnswer(input.value, currentProb);
    renderQuantUI({ root, sessions, onStartGame });
  });
  $('#q-prob-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#q-prob-submit')?.click();
  });
  $('#q-prob-next')?.addEventListener('click', () => {
    currentProb = probGen();
    probFeedback = null;
    renderQuantUI({ root, sessions, onStartGame });
  });

  // F51 handlers
  $('#q-fin-submit')?.addEventListener('click', () => {
    const input = $('#q-fin-input');
    if (!input) return;
    finFeedback = evaluateFinanceAnswer(input.value, currentFin);
    renderQuantUI({ root, sessions, onStartGame });
  });
  $('#q-fin-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#q-fin-submit')?.click();
  });
  $('#q-fin-next')?.addEventListener('click', () => {
    currentFin = finGen();
    finFeedback = null;
    renderQuantUI({ root, sessions, onStartGame });
  });

  // F52 handlers
  $('#q-est-submit')?.addEventListener('click', () => {
    const input = $('#q-est-input');
    if (!input) return;
    estFeedback = evaluateEstimate(input.value, currentEst);
    renderQuantUI({ root, sessions, onStartGame });
  });
  $('#q-est-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#q-est-submit')?.click();
  });
  $('#q-est-next')?.addEventListener('click', () => {
    currentEst = estGen();
    estFeedback = null;
    renderQuantUI({ root, sessions, onStartGame });
  });

  // F53 handlers
  $('#q-run-submit')?.addEventListener('click', () => {
    const input = $('#q-run-input');
    if (!input || runningStepIdx >= currentChain.steps.length) return;
    const step = currentChain.steps[runningStepIdx];
    const res = evaluateRunningStep(input.value, step);
    runningFeedback = res;
    if (res.correct) {
      runningStepIdx++;
    }
    renderQuantUI({ root, sessions, onStartGame });
  });
  $('#q-run-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#q-run-submit')?.click();
  });
  $('#q-run-new')?.addEventListener('click', () => {
    runningSeedCounter++;
    currentChain = generateRunningChain({ length: 5, seed: `running-seed-${runningSeedCounter}` });
    runningStepIdx = 0;
    runningFeedback = null;
    renderQuantUI({ root, sessions, onStartGame });
  });

  // F54 handler: Launch live 80-in-8 session
  $('#q-hist-launch')?.addEventListener('click', () => {
    onStartGame({
      preset: {
        rules: HISTORICAL_80_IN_8_RULES,
        seed: 'hist80-' + Math.random().toString(36).slice(2, 9),
        mode: 'quant',
        generator: createHistorical80in8Generator('hist80-' + Date.now()),
      },
    });
  });

  // F55 handlers: Market making
  $('#mm-quote-submit')?.addEventListener('click', () => {
    const bidVal = Number($('#mm-bid-input')?.value);
    const askVal = Number($('#mm-ask-input')?.value);
    try {
      const roundRes = simulateMarketRound(currentMMScenario, bidVal, askVal, `flow-${Date.now()}`);
      mmRounds.push(roundRes);
      mmFeedback = roundRes;
      renderQuantUI({ root, sessions, onStartGame });
    } catch (err) {
      alert(err.message);
    }
  });

  $('#mm-next-scenario')?.addEventListener('click', () => {
    mmSeedCounter++;
    currentMMScenario = createMarketScenario(`mm-seed-${mmSeedCounter}`);
    mmFeedback = null;
    renderQuantUI({ root, sessions, onStartGame });
  });
}
