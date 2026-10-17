import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK_RULES, customRules, benchmarkEquivalent, validateRules } from '../packages/core/src/rulesets.js';
import { makeQuestion, createGenerator } from '../packages/core/src/generator.js';
import { createRng } from '../packages/core/src/rng.js';

test('default benchmark format and ranges',()=>{
  assert.equal(BENCHMARK_RULES.durationSeconds,120);
  assert.deepEqual(BENCHMARK_RULES.enabled,['add','sub','mul','div']);
  assert.deepEqual(BENCHMARK_RULES.addition.left,[2,100]);
  assert.deepEqual(BENCHMARK_RULES.multiplication.left,[2,12]);
  assert.equal(benchmarkEquivalent(BENCHMARK_RULES),true);
  assert.equal(benchmarkEquivalent(customRules()),false);
});
test('inverse operations and correct values',()=>{
  assert.deepEqual([makeQuestion('add',47,29).left,makeQuestion('add',47,29).right,makeQuestion('add',47,29).answer],[47,29,76]);
  const sub=makeQuestion('sub',47,29);
  assert.equal(sub.left,76);assert.equal(sub.right,47);assert.equal(sub.answer,29);
  const div=makeQuestion('div',7,96);
  assert.equal(div.left,672);assert.equal(div.right,7);assert.equal(div.answer,96);
  assert.equal(makeQuestion('mul',7,96).answer,672);
});
test('seeded generator reproducible and range safe over 10k draws',()=>{
  const a=createGenerator(BENCHMARK_RULES,'same-seed');
  const b=createGenerator(BENCHMARK_RULES,'same-seed');
  const counts={add:0,sub:0,mul:0,div:0};
  for(let i=0;i<10000;i++){
    const q=a();assert.deepEqual(q,b());counts[q.op]++;
    if(q.op==='add'||q.op==='sub'){
      assert.ok(q.sourceLeft>=2&&q.sourceLeft<=100&&q.sourceRight>=2&&q.sourceRight<=100);
      if(q.op==='sub') assert.equal(q.left-q.right,q.answer);
      else assert.equal(q.left+q.right,q.answer);
    }else{
      assert.ok(q.sourceLeft>=2&&q.sourceLeft<=12&&q.sourceRight>=2&&q.sourceRight<=100);
      if(q.op==='div')assert.equal(q.left/q.right,q.answer);
      else assert.equal(q.left*q.right,q.answer);
    }
  }
  for(const n of Object.values(counts))assert.ok(n>2250&&n<2750);
});
test('operation weights increase training sampling, not benchmark',()=>{
  const next=createGenerator(customRules(), 'weighted',{add:1,sub:1,mul:20,div:1});
  let mul=0;for(let i=0;i<1000;i++)if(next().op==='mul')mul++;
  assert.ok(mul>800);
});
test('invalid config and unknown arithmetic rejected',()=>{
  assert.throws(()=>customRules({enabled:[]}));
  assert.throws(()=>customRules({durationSeconds:-5}));
  assert.throws(()=>customRules({addition:{left:[0,3],right:[2,3]}}));
  assert.throws(()=>makeQuestion('power',4,5));
  assert.throws(()=>createGenerator(customRules(), 'weights',{add:0,sub:0,mul:0,div:0}));
});
