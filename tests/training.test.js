import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAdaptive, operationDrill, sprintRules, DRILL_CATALOG } from '../packages/training/src/drills.js';
import { dailyPlan, candidatePriority } from '../packages/training/src/planner.js';
import { scheduleReview } from '../packages/training/src/scheduler.js';
import { assignStrategyTrial } from '../packages/training/src/experiment.js';
import { LESSONS } from '../packages/curriculum/src/lessons.js';
import { createQuantGenerator } from '../packages/quant/src/generator.js';
test('adaptive selection defaults safely and concentrates on observed weakness',()=>{
  assert.equal(chooseAdaptive([]).primary,'mul');
  const events=[...Array.from({length:20},()=>({op:'div',tags:['div'],correct:true,responseMs:5000})),...Array.from({length:20},()=>({op:'add',tags:['add'],correct:true,responseMs:700}))];
  const selected=chooseAdaptive([{events}]);assert.equal(selected.primary,'div');assert.equal(selected.weights.div,4);
  assert.ok(selected.weights.add<selected.weights.div);
});
test('daily plan totals 15 min',()=>{
  const plan=dailyPlan([]);assert.equal(plan.steps.reduce((a,b)=>a+b.minutes,0),15);
  assert.equal(candidatePriority({frequency:.3,excessMs:300,trainability:.5,practiceMinutes:10}),4.5);
});
test('scheduler and experiment primitives are deterministic',()=>{
  const d=new Date('2026-10-17T12:00:00Z');const scheduled=scheduleReview({},true,d);
  assert.equal(scheduled.intervalDays,1);
  assert.equal(scheduleReview(scheduled,true,d).intervalDays,2);
  assert.equal(assignStrategyTrial('alice',0),assignStrategyTrial('alice',2));
});
test('lessons are unique with correct illustrative answers',()=>{
  assert.equal(new Set(LESSONS.map(x=>x.id)).size,LESSONS.length);
  assert.ok(LESSONS.length>=12);
  for(const lesson of LESSONS)assert.ok(Number.isFinite(lesson.result));
});
test('quant generator separate namespace, deterministic',()=>{
  const a=createQuantGenerator('x'),b=createQuantGenerator('x');
  for(let i=0;i<20;i++){
    assert.deepEqual(a(),b());
    assert.equal(a().mode,'quant');b();
  }
  assert.equal(DRILL_CATALOG.find(x=>x.id==='quant').implemented,true);
  assert.equal(operationDrill('mul').enabled.length,1);
  assert.equal(sprintRules().durationSeconds,30);
});
