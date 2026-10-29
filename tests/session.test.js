import test from 'node:test';
import assert from 'node:assert/strict';
import { ArithmeticSession } from '../packages/core/src/session.js';
import { BENCHMARK_RULES, customRules } from '../packages/core/src/rulesets.js';
import { makeQuestion } from '../packages/core/src/generator.js';

const fakeSession=(rules=BENCHMARK_RULES)=>{
  let t=0;
  let q=0;
  const session=new ArithmeticSession({rules,clock:()=>t,wallClock:()=>new Date(0).toISOString(),generator:()=>makeQuestion('add',2,3,++q),mode:rules.id==='custom'?'custom':'benchmark',seed:'test'});
  return {session,move:ms=>t+=ms};
};
test('start, solve, timings, corrections and score',()=>{
  const {session,move}=fakeSession();session.start();move(800);
  assert.equal(session.recordInput('4',''),false);move(200);
  assert.equal(session.recordInput('','4'),false);move(200);
  assert.equal(session.recordInput('5',''),true);
  assert.equal(session.score,1);assert.equal(session.events[0].responseMs,1200);
  assert.equal(session.events[0].firstInputMs,800);
  assert.equal(session.events[0].entryMs,400);
  assert.equal(session.events[0].corrections,1);
  assert.equal(session.current.sequence,2);
});
test('wrong partial and wrong Enter never score',()=>{
  const {session}=fakeSession();session.start();session.recordInput('6');session.markWrongSubmission();assert.equal(session.score,0);
  session.recordInput('5','6');assert.equal(session.events[0].wrongSubmissions,1);
});
test('timed finish preserves completed benchmark and open problem',()=>{
  const {session,move}=fakeSession();session.start();move(120000);
  const result=session.finish();assert.equal(result.elapsedMs,120000);assert.equal(result.benchmark,true);
  assert.ok(result.finalUnanswered);assert.equal(session.state,'finished');
  assert.equal(session.recordInput('5'),false);
  assert.deepEqual(session.finish(),result);
});
test('early-finished benchmark is ineligible at the core layer',()=>{
  const {session,move}=fakeSession();session.start();move(60000);
  assert.equal(session.finish().benchmark,false);
});
test('custom score never counts as benchmark even with default ranges',()=>{
  const {session,move}=fakeSession(customRules());session.start();move(120000);
  assert.equal(session.finish().benchmark,false);
});
test('a chosen seed is practice even with benchmark rules and a full duration',()=>{
  const finish=(seedSource)=>{
    let t=0;
    const session=new ArithmeticSession({rules:BENCHMARK_RULES,clock:()=>t,wallClock:()=>new Date(0).toISOString(),generator:()=>makeQuestion('add',2,3,1),mode:'benchmark',seed:'abc',seedSource});
    session.start();t+=120000;
    return session.finish();
  };
  for(const seedSource of ['user','preset','typed']){
    const result=finish(seedSource);
    assert.equal(result.benchmark,false,seedSource);
    assert.equal(result.elapsedMs,120000);
    assert.equal(result.mode,'benchmark');
    assert.equal(result.rules,BENCHMARK_RULES);
  }
  const random=finish('random');
  assert.equal(random.benchmark,true);
  assert.equal(random.seedSource,'random');
  const {session,move}=fakeSession();session.start();move(120000);
  const legacy=session.finish();
  assert.equal(legacy.benchmark,true);
  assert.equal('seedSource' in legacy,false);
});
