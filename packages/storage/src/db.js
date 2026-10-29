import { sanitizeImportedSession, sanitizeImportedSkillReview, sanitizeImportedDailyPlan, flagRepeatedBenchmarkSeeds } from './sanitize.js';
import { skillReviewRecord } from '../../training/src/scheduler.js';
const DATABASE='zetamaster-v1';
const FALLBACK_KEY='zetamaster-sessions-v1';
const REVIEW_KEY='zetamaster-skill-reviews-v1';
const PLAN_KEY='zetamaster-daily-plans-v1';
const MAX_FALLBACK=500;
const REVIEW_STORE='skillReviews';
const PLAN_STORE='dailyPlans';
/** Storage schema 2 added the versioned skill-review store (F19); schema 3 adds the daily-plan
 * completion store (F34). Additive only: existing stores are untouched by onupgradeneeded, so v1
 * users upgrade in place. Opening this schema from an older cached page would fail with a version
 * error; the service-worker cache bump keeps pages fresh. */
const STORAGE_VERSION=3;

function open() {
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in globalThis)) {reject(new Error('IndexedDB unavailable'));return;}
    const req=indexedDB.open(DATABASE,STORAGE_VERSION);
    req.onupgradeneeded=()=>{const db=req.result; if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'id'}); if(!db.objectStoreNames.contains(REVIEW_STORE))db.createObjectStore(REVIEW_STORE,{keyPath:'id'}); if(!db.objectStoreNames.contains(PLAN_STORE))db.createObjectStore(PLAN_STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function transact(storeName, type, action) {
  const db=await open();
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,type);
    const request=action(tx.objectStore(storeName));
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    tx.onerror=()=>reject(tx.error);
  });} finally {db.close();}
}
function fallbackRead(key){try{return JSON.parse(localStorage.getItem(key) || '[]');}catch{return [];}}
function fallbackWrite(key,xs){localStorage.setItem(key,JSON.stringify(xs.slice(-MAX_FALLBACK)));}
export async function listSessions() {
  try{return (await transact('sessions','readonly',store=>store.getAll())).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));}
  catch{return fallbackRead(FALLBACK_KEY).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));}
}
export async function saveSession(session) {
  const record={...session,id:session.id+'-'+(globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2))};
  try{await transact('sessions','readwrite',store=>store.put(record));}
  catch{fallbackWrite(FALLBACK_KEY,[...fallbackRead(FALLBACK_KEY),record]);}
  return record;
}
export async function deleteAllSessions() {
  try{await transact('sessions','readwrite',store=>store.clear());}catch{}
  try{localStorage.removeItem(FALLBACK_KEY);}catch{}
}
export async function importSessions(records) {
  if(!Array.isArray(records))throw new Error('Import must be an array');
  if(records.length>10000)throw new Error('Import exceeds 10,000 sessions');
  const accepted=[];
  for(const raw of records){
    const s=sanitizeImportedSession(raw);
    if(s)accepted.push(s);
  }
  const flagged=flagRepeatedBenchmarkSeeds(accepted);
  for(const s of flagged) await saveSession(s);
  return flagged.length;
}

// Per-skill spaced-repetition records (F19): same discipline as sessions — IndexedDB first, capped
// localStorage fallback, sanitized imports. Records are keyed by skill id and carry the taxonomy
// version; see docs/SKILLS.md for the record shape and migration contract.
export async function listSkillReviews() {
  try{return await transact(REVIEW_STORE,'readonly',store=>store.getAll());}
  catch{return fallbackRead(REVIEW_KEY);}
}
export async function saveSkillReview(record) {
  try{await transact(REVIEW_STORE,'readwrite',store=>store.put(record));}
  catch{fallbackWrite(REVIEW_KEY,[...fallbackRead(REVIEW_KEY).filter(r=>r?.id!==record?.id),record]);}
  return record;
}
/**
 * Record one review outcome for a skill, composing the pure `skillReviewRecord` primitive. `now` is
 * explicit (an ISO string or Date) so scheduling is deterministic in tests; production callers may
 * omit it. `skillId` should come from the current taxonomy (`skillCellFor`/`skillRollups`); record
 * ids are not re-validated here — imported records are validated by `sanitizeImportedSkillReview`.
 */
export async function recordSkillReview(skillId, wasFastAndCorrect, now = new Date()) {
  const existing=(await listSkillReviews()).find(r=>r?.id===skillId) ?? null;
  const updated=skillReviewRecord(skillId, existing, wasFastAndCorrect, now);
  await saveSkillReview(updated);
  return updated;
}
export async function importSkillReviews(records) {
  if(!Array.isArray(records))throw new Error('Import must be an array');
  if(records.length>10000)throw new Error('Import exceeds 10,000 skill records');
  let imported=0, dropped=0;
  for(const raw of records){
    const r=sanitizeImportedSkillReview(raw);
    if(!r){dropped++;continue;}
    await saveSkillReview(r); imported++;
  }
  return { imported, dropped, total: records.length };
}

// Daily-plan completion records (F34, schema 3): one record per local day, no score data by
// design. Same discipline as above — IndexedDB first, capped localStorage fallback, sanitized and
// whitelist-reconstructed imports.
export async function listDailyPlans() {
  try{return await transact(PLAN_STORE,'readonly',store=>store.getAll());}
  catch{return fallbackRead(PLAN_KEY);}
}
export async function saveDailyPlan(record) {
  try{await transact(PLAN_STORE,'readwrite',store=>store.put(record));}
  catch{fallbackWrite(PLAN_KEY,[...fallbackRead(PLAN_KEY).filter(r=>r?.id!==record?.id),record]);}
  return record;
}
export async function importDailyPlans(records) {
  if(!Array.isArray(records))throw new Error('Import must be an array');
  if(records.length>5000)throw new Error('Import exceeds 5,000 daily-plan records');
  let imported=0, dropped=0;
  for(const raw of records){
    const r=sanitizeImportedDailyPlan(raw);
    if(!r){dropped++;continue;}
    await saveDailyPlan(r); imported++;
  }
  return { imported, dropped, total: records.length };
}
/** Removes the day's completion record (only locally, and only when the user deletes history). */
export async function deleteAllDailyPlans() {
  try{await transact(PLAN_STORE,'readwrite',store=>store.clear());}catch{}
  try{localStorage.removeItem(PLAN_KEY);}catch{}
}
