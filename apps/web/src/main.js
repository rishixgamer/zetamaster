import { BENCHMARK_RULES, customRules } from '../../../packages/core/src/rulesets.js';
import { createGenerator, makeQuestion } from '../../../packages/core/src/generator.js';
import { ArithmeticSession } from '../../../packages/core/src/session.js';
import { sessionStats, operationSummary } from '../../../packages/analytics/src/stats.js';
import { benchmarkProgress } from '../../../packages/analytics/src/progress.js';
import { diagnose } from '../../../packages/analytics/src/diagnostics.js';
import { errorTypology } from '../../../packages/analytics/src/errors.js';
import { chooseAdaptive, operationDrill, sprintRules, enduranceRules } from '../../../packages/training/src/drills.js';
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
function startGame({ replay=null }={}) {
  if(currentSession?.state==='active')return;
  const mode=replay?'replay':$('#mode').value;
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
  } catch(error){alert(error.message);return;}
  currentSeed=$('#seed').value.trim() || crypto.randomUUID();
  if(replay) {
    let index=0;
    const items=replay.map(q=>makeQuestion(q.op,q.sourceLeft,q.sourceRight,++index));
    let cursor=0;
    generator=()=>{const q=items[cursor%items.length];cursor++;return {...q,id:`replay-${cursor}`,sequence:cursor};};
  } else generator=createGenerator(rules,currentSeed,weights);
  currentMode=mode; currentReplay=replay;
  currentSession=new ArithmeticSession({rules,generator,mode,seed:currentSeed});
  currentSession.start();
  $('#idle-layout').classList.add('hidden');$('#top-metrics').classList.add('hidden');$('#results').classList.add('hidden');$('#game').classList.remove('hidden');
  $('#game-mode').textContent=mode==='benchmark'?'STANDARD BENCHMARK':`${mode.toUpperCase()} PRACTICE`;
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
  const p=benchmarkProgress(sessions), allEvents=sessions.flatMap(s=>s.events??[]), ops=operationSummary(allEvents), diagnostics=diagnose(sessions);
  const worst=diagnostics.weaknesses.filter(w=>w.kind==='operation' && w.count>=5).slice(0,2);
  const recent=sessions.slice(0,8);
  const maxTime=Math.max(5000,...ops.map(x=>x.medianMs??0));
  const chart=p.trajectory.slice(-20);
  $('#analytics-root').innerHTML=`
    <div class="stat-grid"><div class="metric"><span>BEST BENCHMARK</span><strong>${p.personalBest??'—'}</strong></div><div class="metric"><span>RECENT MEDIAN</span><strong>${p.recentMedian??'—'}</strong></div><div class="metric"><span>70+ MASTERY</span><strong>${p.mastery70?'YES':'NOT YET'}</strong></div></div>
    <div class="analysis-grid"><div class="panel"><h2 class="section-title">Time by operation</h2><div class="breakdown">${ops.map(o=>`<div class="breakdown-row"><span>${opNames[o.op]}</span><div class="bar"><div style="width:${Math.max(0,(o.medianMs??0)/maxTime*100)}%"></div></div><span>${fmt(o.medianMs)} <span class="muted">(${o.count})</span></span></div>`).join('')}</div><p class="secondary">Median per correctly solved problem. Lower is faster. Small samples may be unreliable.</p></div>
    <div class="panel"><h2 class="section-title">Recent benchmark scores</h2>${chart.length?`<div class="sparkline" role="img" aria-label="Recent benchmark scores">${chart.map(x=>`<div title="${x.score} correct" style="height:${Math.min(100,Math.max(3,x.score/90*100))}%"></div>`).join('')}</div><p class="small muted">Last ${chart.length} standard runs · Personal best ${p.personalBest}</p>`:'<div class="empty">Complete a standard benchmark to start your chart.</div>'}</div></div>
    <div class="analysis-grid"><div class="panel"><h2 class="section-title">Current bottlenecks</h2>${worst.length?worst.map(w=>`<p class="secondary"><strong>${opNames[w.key]}</strong> · ${fmt(w.rawMedianMs)} median · ${w.count} observations</p>`).join(''):'<p class="secondary">More solved questions needed before identifying reliable weaknesses.</p>'}<p class="small muted">Heuristic, sample-size-smoothed estimates; not a validated cognitive assessment.</p></div>
    <div class="panel"><h2 class="section-title">Slowest questions</h2>${allEvents.length?[...allEvents].sort((a,b)=>b.responseMs-a.responseMs).slice(0,5).map(q=>`<div class="history-row"><span>${esc(`${q.left} ${q.symbol} ${q.right} = ${q.answer}`)}</span><strong>${fmt(q.responseMs)}</strong><span>${esc(q.op)}</span></div>`).join(''):'<div class="empty">No solved questions yet.</div>'}<button type="button" class="secondary-btn" id="replay-slow" ${allEvents.length?'':'disabled'}>Replay slowest five →</button></div></div>
    <div class="panel"><h2 class="section-title">Recent sessions</h2>${recent.length?recent.map(s=>`<div class="history-row"><span>${esc(new Date(s.startedAt).toLocaleString())} · ${esc(s.mode)}${s.benchmark?' · verified':''}</span><strong>${esc(s.score)}</strong><span>${s.benchmark?'Standard':'Practice'}</span></div>`).join(''):'<div class="empty">Your first session will appear here.</div>'}</div>
    <div class="data-actions"><button type="button" id="export-json">Export complete JSON</button><button type="button" id="export-csv">Export session CSV</button><button type="button" id="import-json">Import JSON</button><button type="button" class="warning" id="clear-history">Delete local history</button><input type="file" id="import-file" accept="application/json" hidden></div><p class="small muted">Data stays on this device unless you export it. Browsers may clear local data under storage pressure.</p>`;
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
  $('#again').addEventListener('click',()=>{showIdle();startGame({replay:currentReplay});});
  $('#analyze-result').addEventListener('click',()=>{showIdle();setView('analytics');});
  $$('#lesson-filters button').forEach(button=>button.addEventListener('click',()=>{$$('#lesson-filters button').forEach(b=>b.classList.toggle('selected',b===button));renderLessons(button.dataset.op);}));
}
bind();updateMode();renderLessons();renderRoadmap();refresh().catch(error=>console.error('History loading failed',error));
if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('Offline registration unavailable',error));
