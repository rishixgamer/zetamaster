import { BENCHMARK_RULES, customRules } from '../../../packages/core/src/rulesets.js';
import { createGenerator, makeQuestion } from '../../../packages/core/src/generator.js';
import { ArithmeticSession } from '../../../packages/core/src/session.js';
import { sessionStats, operationSummary } from '../../../packages/analytics/src/stats.js';
import { benchmarkProgress } from '../../../packages/analytics/src/progress.js';
import { diagnose } from '../../../packages/analytics/src/diagnostics.js';
import { errorTypology } from '../../../packages/analytics/src/errors.js';
import { consistencySummary } from '../../../packages/analytics/src/consistency.js';
import { paceProfile, tailProfile } from '../../../packages/analytics/src/fatigue.js';
import { entryQuality, MIN_TYPE_SAMPLES } from '../../../packages/analytics/src/entry-quality.js';
import { buildHeatmap, slowestCells, MIN_CELL_SAMPLES } from '../../../packages/analytics/src/heatmap.js';
import { chooseAdaptive, operationDrill, sprintRules, enduranceRules, cellDrill } from '../../../packages/training/src/drills.js';
import { scoreChartSvg, chartLayout, nearestIndex, CHART } from './score-chart.js';
import { nextGridPosition, heatmapHash, parseHeatmapHash } from './grid-nav.js';
import { dailyPlan } from '../../../packages/training/src/planner.js';
import { LESSONS } from '../../../packages/curriculum/src/lessons.js';
import { suggestLesson } from '../../../packages/curriculum/src/explanations.js';
import { listSessions, saveSession, deleteAllSessions, importSessions } from '../../../packages/storage/src/db.js';
import { downloadJson, downloadCsv } from '../../../packages/storage/src/export.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = value => Number.isFinite(value) ? (value/1000).toFixed(2)+'s' : '—';
const opNames={add:'Addition',sub:'Subtraction',mul:'Multiplication',div:'Division'};
const durationFormat = ms => { const seconds=Math.ceil(Math.max(0,ms)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; };
const getOps=()=>$$('#ops input:checked').map(x=>x.value);
let sessions=[];
let currentSession=null;
let tick=null;
const MAX_FIELD=24;
let currentMode='benchmark';
let currentReplay=null;
let currentDrill=null;
const heatmapState={op:'mul',scope:'benchmark',focus:{row:0,col:0},selected:null};
let currentSeed='';
let lastResult=null;

async function refresh() {
  sessions=await listSessions();
  const p=benchmarkProgress(sessions);
  const values=[p.personalBest??'—',p.recentMedian??'—',p.count,'70+'];
  $$('#top-metrics .metric strong').forEach((el,i)=>el.textContent=values[i]);
  const plan=dailyPlan(sessions);
  $('#plan-rationale').textContent=plan.rationale;
  $('#plan-steps').innerHTML=plan.steps.map((x,i)=>`<div class="step"><span class="step-num">${i+1}</span><span class="step-title">${esc(x.title)}</span><span class="step-time">${x.minutes} min</span></div>`).join('');
  renderAnalytics();
}
function setView(view) {
  $$('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+view));
  $$('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  window.scrollTo({top:0,behavior:'auto'});
}
function updateMode() {
  const mode=$('#mode').value;
  const hints={
    benchmark:'Strict 120-second benchmark. All operations, standard ranges, no skips or pausing. Ending early invalidates the benchmark.',
    adaptive:'Weights weaker operations more heavily, using response times from your history. Not a standardized score.',
    custom:'Choose one or more operations and a time limit. Custom scores are separate from the benchmark.',
    isolation:'Practices the first checked operation only. Choose exactly one for clarity.',
    sprint:'30-second mixed-operation sprint. Practice score only.',
    endurance:'300-second mixed-operation endurance session. Practice score only.',
  };
  $('#mode-hint').textContent=hints[mode];
  $('#duration').disabled=['benchmark','sprint','endurance'].includes(mode);
  $('#duration').value={benchmark:'120',sprint:'30',endurance:'300'}[mode]||$('#duration').value;
  $$('#ops input').forEach(x=>x.disabled=!['custom','isolation'].includes(mode));
}
function startGame({ replay=null, drill=null }={}) {
  if(currentSession?.state==='active')return;
  const mode=drill?'drill':replay?'replay':$('#mode').value;
  let rules, weights=null, generator=null;
  const seconds=Number($('#duration').value);
  const selected=getOps();
  try {
    if(mode==='benchmark')rules=BENCHMARK_RULES;
    else if(mode==='adaptive') {const selection=chooseAdaptive(sessions,seconds);rules=selection.rules;weights=selection.weights;}
    else if(mode==='custom')rules=customRules({durationSeconds:seconds,enabled:selected});
    else if(mode==='isolation')rules=operationDrill(selected[0],seconds);
    else if(mode==='sprint')rules=sprintRules(30);
    else if(mode==='endurance')rules=enduranceRules(300);
    else if(mode==='replay')rules=customRules({durationSeconds:120});
    else if(mode==='drill')rules=cellDrill(drill.op,drill,60);
  } catch(error){alert(error.message);return;}
  currentSeed=$('#seed').value.trim() || crypto.randomUUID();
  if(replay) {
    let index=0;
    const items=replay.map(q=>makeQuestion(q.op,q.sourceLeft,q.sourceRight,++index));
    let cursor=0;
    generator=()=>{const q=items[cursor%items.length];cursor++;return {...q,id:`replay-${cursor}`,sequence:cursor};};
  } else generator=createGenerator(rules,currentSeed,weights);
  currentMode=mode; currentReplay=replay; currentDrill=drill;
  currentSession=new ArithmeticSession({rules,generator,mode,seed:currentSeed,drill:drill?{op:drill.op,cell:drill.key,label:drill.label}:null});
  currentSession.start();
  $('#idle-layout').classList.add('hidden');$('#top-metrics').classList.add('hidden');$('#results').classList.add('hidden');$('#game').classList.remove('hidden');
  $('#game-mode').textContent=mode==='benchmark'?'STANDARD BENCHMARK':mode==='drill'?`DRILL · ${drill.label} · PRACTICE`:`${mode.toUpperCase()} PRACTICE`;
  $('#game-score').innerHTML='0 <small>correct</small>';
  $('#answer').value='';
  updateQuestion(); renderTick(); clearInterval(tick); tick=setInterval(renderTick,60);
  $('#answer').focus();
}
function updateQuestion() {
  const q=currentSession.current;
  $('#problem').textContent=`${q.left} ${q.symbol} ${q.right}`;
  $('#game-score').innerHTML=`${currentSession.score} <small>correct</small>`;
}
function renderTick() {
  if(currentSession?.state!=='active')return;
  const ms=currentSession.tick();
  $('#timer').textContent=durationFormat(ms);
  $('#time-fill').style.width=(100*ms/(currentSession.rules.durationSeconds*1000)).toFixed(2)+'%';
  if(currentSession.state==='finished')finishGame(false);
}
function answerInput(event) {
  if(currentSession?.state!=='active')return;
  const input=event.currentTarget;
  // Like the original, the field is not sanitized: stray characters must be deleted by the player.
  if(input.value.length>MAX_FIELD)input.value=input.value.slice(0,MAX_FIELD);
  const solved=currentSession.recordInput(input.value);
  if(currentSession.state==='finished'){finishGame(false);return;}
  if(solved){input.value='';updateQuestion();}
}
async function finishGame(endedEarly) {
  if(!currentSession || currentSession.state==='ready')return;
  clearInterval(tick);tick=null;
  // The core marks manual or short runs as ineligible; the UI never upgrades a result to benchmark.
  const result=currentSession.finish({endedEarly});
  if(!result || lastResult===result)return;
  lastResult=result;
  await saveSession(result);
  $('#game').classList.add('hidden');$('#results').classList.remove('hidden');
  $('#result-title').textContent=result.benchmark?'Standard benchmark completed':`${result.mode} session completed`;
  $('#result-score').textContent=result.score;
  const stats=sessionStats(result);
  const typology=errorTypology(result.events);
  const hidden=result.integrity?.hiddenMs>0?` · tab hidden ${fmt(result.integrity.hiddenMs)} (clock kept running)`:'';
  $('#result-detail').innerHTML=`<p class="secondary">${result.events.length} solved · median ${fmt(stats.medianMs)} per question · 90th percentile ${fmt(stats.p90Ms)}${result.benchmark?' · valid benchmark':' · practice/unverified'}${hidden}</p>${typologyHtml(typology)}`;
  await refresh();
}
const ERROR_LABELS={clean:'Clean entry',revision:'Revised (deleted a correct digit)',slip:'Slip (wrong digit, fixed mid-entry)',calculation:'Calculation error (complete wrong answer first)'};
function typologyHtml(t){
  if(!t.total)return '';
  return `<div class="breakdown typology" aria-label="Entry quality">${t.types.map(x=>`<div class="breakdown-row"><span>${ERROR_LABELS[x.type]}</span><div class="bar"><div style="width:${(100*(x.share??0)).toFixed(1)}%"></div></div><span>${x.count} <span class="muted">· ${fmt(x.medianMs)}</span></span></div>`).join('')}</div><p class="small muted">Counts of solved questions by entry pattern, with median solve time. Derived from keystroke telemetry; slips and revisions cost time but never cost points.</p>`;
}
function showIdle(){if(currentSession?.state==='active')return;$('#idle-layout').classList.remove('hidden');$('#top-metrics').classList.remove('hidden');$('#game').classList.add('hidden');$('#results').classList.add('hidden');}
function renderAnalytics(){
  const allEvents=sessions.flatMap(s=>s.events??[]), ops=operationSummary(allEvents), diagnostics=diagnose(sessions);
  const worst=diagnostics.weaknesses.filter(w=>w.kind==='operation' && w.count>=5).slice(0,2);
  const recent=sessions.slice(0,8);
  const maxTime=Math.max(5000,...ops.map(x=>x.medianMs??0));
  $('#analytics-root').innerHTML=`
    <section class="panel" id="consistency-root" aria-labelledby="consistency-title"></section>
    <section class="panel" id="pace-root" aria-labelledby="pace-title"></section>
    <section class="panel" id="entry-root" aria-labelledby="entry-title"></section>
    <section class="panel" id="heatmap-root" aria-labelledby="heatmap-title"></section>
    <div class="panel"><h2 class="section-title">Time by operation</h2><div class="breakdown">${ops.map(o=>`<div class="breakdown-row"><span>${opNames[o.op]}</span><div class="bar"><div style="width:${Math.max(0,(o.medianMs??0)/maxTime*100)}%"></div></div><span>${fmt(o.medianMs)} <span class="muted">(${o.count}${o.ci?` · CI ${fmt(o.ci.low)}–${fmt(o.ci.high)}`:''})</span></span></div>`).join('')}</div><p class="secondary">Median per correctly solved problem across all sessions, with sample count and a 95% CI of the median once there are 6 or more. Lower is faster. Practice sessions included.</p></div>
    <div class="analysis-grid"><div class="panel"><h2 class="section-title">Current bottlenecks</h2>${worst.length?worst.map(w=>`<p class="secondary"><strong>${opNames[w.key]}</strong> · ${fmt(w.rawMedianMs)} median · ${w.count} observations</p>`).join(''):'<p class="secondary">More solved questions needed before identifying reliable weaknesses.</p>'}<p class="small muted">Heuristic, sample-size-smoothed estimates; not a validated cognitive assessment.</p></div>
    <div class="panel"><h2 class="section-title">Slowest questions</h2>${allEvents.length?[...allEvents].sort((a,b)=>b.responseMs-a.responseMs).slice(0,5).map(q=>`<div class="history-row"><span>${esc(`${q.left} ${q.symbol} ${q.right} = ${q.answer}`)}</span><strong>${fmt(q.responseMs)}</strong><span>${esc(q.op)}</span></div>`).join(''):'<div class="empty">No solved questions yet.</div>'}<button type="button" class="secondary-btn" id="replay-slow" ${allEvents.length?'':'disabled'}>Replay slowest five →</button></div></div>
    <div class="panel"><h2 class="section-title">Recent sessions</h2>${recent.length?recent.map(s=>`<div class="history-row"><span>${esc(new Date(s.startedAt).toLocaleString())} · ${esc(s.mode)}${s.benchmark?' · verified':''}</span><strong>${esc(s.score)}</strong><span>${s.benchmark?'Standard':'Practice'}</span></div>`).join(''):'<div class="empty">Your first session will appear here.</div>'}</div>
    <div class="data-actions"><button type="button" id="export-json">Export complete JSON</button><button type="button" id="export-csv">Export session CSV</button><button type="button" id="import-json">Import JSON</button><button type="button" class="warning" id="clear-history">Delete local history</button><input type="file" id="import-file" accept="application/json" hidden></div><p class="small muted">Data stays on this device unless you export it. Browsers may clear local data under storage pressure.</p>`;
  renderConsistency();
  renderPace();
  renderEntry();
  renderHeatmap();
  $('#replay-slow').addEventListener('click',()=>{
    const slow=[...allEvents].sort((a,b)=>b.responseMs-a.responseMs).slice(0,5);
    if(!slow.length)return;
    setView('train');showIdle();startGame({replay:slow});
  });
  $('#export-json').addEventListener('click',()=>downloadJson('zetamaster-sessions.json',sessions));
  $('#export-csv').addEventListener('click',()=>downloadCsv('zetamaster-sessions.csv',sessions));
  $('#import-json').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    try {const entries=JSON.parse(await file.text());const count=await importSessions(entries);await refresh();alert(`Imported ${count} sessions.`);}
    catch(error){alert(`Import failed: ${error.message}`);}
  });
  $('#clear-history').addEventListener('click',async()=>{
    if(confirm('Permanently delete all ZetaMaster session history on this device?')){await deleteAllSessions();await refresh();}
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
function renderPace(){
  const root=$('#pace-root'); if(!root)return;
  const pace=paceProfile(sessions), tail=tailProfile(sessions), h=pace.halfShift;
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
    <p class="small muted">"Slow" means over the larger of 2× your typical time and a robust outlier cutoff (median + 3 MADs on the log scale). Time lost is the median per run of the time beyond typical spent on slow questions. Definitions: docs/FATIGUE.md.</p>`;
}
const OP_GLYPH={add:'+',sub:'–',mul:'×',div:'÷'};
const ENTRY_SHORT={clean:'Clean',revision:'Revised',slip:'Slip',calculation:'Calculation'};
function renderEntry(){
  const root=$('#entry-root'); if(!root)return;
  const q=entryQuality(sessions);
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
    ${notes}`;
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
  return `<h3 class="cell-title">${esc(c.label)}</h3>
    <dl class="cell-stats"><dt>Solved</dt><dd>${c.count} <span class="muted">(${esc(c.evidence)})</span></dd><dt>Median</dt><dd>${fmt(c.medianMs)}</dd><dt>95% CI of median</dt><dd>${ci}</dd><dt>Smoothed relative speed</dt><dd>${rel}</dd><dt>Not clean entry</dt><dd>${c.flawedShare===null?'—':Math.round(100*c.flawedShare)+'%'}</dd></dl>
    <button type="button" class="primary-btn" id="drill-cell">Drill ${esc(c.label)} · 60s practice ↗</button>
    <p class="small muted">Drills only show problems from this cell and are saved as practice. They never count toward benchmark scores, and they're excluded from the benchmark-only heatmap.</p>`;
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
    startGame({drill:{op:h.op,key:selectedCell.key,label:selectedCell.label,rowRange:selectedCell.rowRange,colRange:selectedCell.colRange}});
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
function renderLessons(filter='all') {
  const list=filter==='all'?LESSONS:LESSONS.filter(l=>l.operation===filter);
  $('#lessons').innerHTML=list.map(l=>`<article class="lesson-card"><div class="eyebrow">${esc(opNames[l.operation])}</div><h3>${esc(l.title)}</h3><div class="lesson-equation">${esc(l.example)}</div><ol>${l.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol><strong>Answer: ${l.result}</strong></article>`).join('');
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
  $('#again').addEventListener('click',()=>{showIdle();startGame({replay:currentReplay,drill:currentDrill});});
  $('#analyze-result').addEventListener('click',()=>{showIdle();setView('analytics');});
  $$('#lesson-filters button').forEach(button=>button.addEventListener('click',()=>{$$('#lesson-filters button').forEach(b=>b.classList.toggle('selected',b===button));renderLessons(button.dataset.op);}));
}
bind();updateMode();renderLessons();renderRoadmap();applyHeatmapHash();refresh().catch(error=>console.error('History loading failed',error));
if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('Offline registration unavailable',error));
