import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const spec=JSON.parse(readFileSync(new URL('../specs/features.json',import.meta.url),'utf8'));
test('all 55 brainstormed features remain traceable',()=>{
  assert.equal(spec.featureCount,55);
  assert.equal(spec.features.length,55);
  assert.deepEqual(spec.features.map(f=>f.id),Array.from({length:55},(_,i)=>`F${String(i+1).padStart(2,'0')}`));
  for(const item of spec.features){
    assert.ok(['implemented','partial','planned'].includes(item.status));
    assert.ok(item.acceptance?.[0]?.length>20);
    assert.ok(item.owner);
  }
});
