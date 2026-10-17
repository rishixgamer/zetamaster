import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE_NAMESPACE,SCHEMA_VERSION } from '../packages/contracts/src/schema.js';
test('future mode namespaces preserve benchmark isolation',()=>{
  assert.equal(SCHEMA_VERSION,1);
  assert.equal(MODE_NAMESPACE.benchmark,'arithmetic-standard');
  for(const [key,value] of Object.entries(MODE_NAMESPACE))if(key!=='benchmark')assert.notEqual(value,'arithmetic-standard');
});
