import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, median, percentile, operationSummary, sessionStats } from '../packages/analytics/src/stats.js';
import { diagnose } from '../packages/analytics/src/diagnostics.js';
import { benchmarkProgress, detectPlateau } from '../packages/analytics/src/progress.js';
import { aggregateHeatmap } from '../packages/analytics/src/heatmap.js';
import { masteryProxy } from '../packages/analytics/src/skill-model.js';
const sample=(score, benchmark=true, i=0)=>({score,benchmark,startedAt:new Date(2026,0,i+1).toISOString(),events:[]});
test('summary functions work with empty datasets and odd/even samples',()=>{
  assert.equal(mean([]),null);assert.equal(median([]),null);assert.equal(percentile([],.9),null);
  assert.equal(median([5,1,4,2]),3.0);assert.equal(median([2,5,1]),2);
  assert.equal(sessionStats(null).score,0);
  assert.equal(operationSummary([]).length,4);
});
test('never contaminate benchmarks with custom sessions',()=>{
  const xs=[sample(65,true,0),sample(22,false,1),sample(72,true,2)];
  const result=benchmarkProgress(xs);
  assert.equal(result.count,2);assert.equal(result.personalBest,72);assert.equal(result.recentMedian,68.5);
});
test('mastery rule uses last ten standardized sessions',()=>{
  const xs=Array.from({length:10},(_,i)=>sample(i<8?70:60,true,i));
  assert.equal(benchmarkProgress(xs).mastery70,true);
  xs[7].score=69;
  assert.equal(benchmarkProgress(xs).mastery70,false);
});
test('weakness detection handles sparse and tagged data',()=>{
  const events=[...Array.from({length:10},(_,i)=>({op:'mul',tags:['mul','table-7'],responseMs:5000,correct:true,sourceLeft:7,sourceRight:i+2})),...Array.from({length:10},(_,i)=>({op:'add',tags:['add'],responseMs:900,correct:true,sourceLeft:3,sourceRight:i+2}))];
  const d=diagnose([{events}]);assert.equal(d.observations,20);
  assert.equal(d.weaknesses[0].key,'mul');
  assert.equal(aggregateHeatmap([{events}]).length,20);
  assert.ok(masteryProxy(events,'table-7').estimate<.5);
  assert.equal(detectPlateau([sample(30)]).status,'insufficient-data');
});
