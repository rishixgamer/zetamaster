import { sanitizeImportedSession } from './sanitize.js';
const DATABASE='zetamaster-v1';
const FALLBACK_KEY='zetamaster-sessions-v1';
const MAX_FALLBACK=500;

function open() {
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in globalThis)) {reject(new Error('IndexedDB unavailable'));return;}
    const req=indexedDB.open(DATABASE,1);
    req.onupgradeneeded=()=>{const db=req.result; if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function transact(type, action) {
  const db=await open();
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('sessions',type);
    const request=action(tx.objectStore('sessions'));
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    tx.onerror=()=>reject(tx.error);
  });} finally {db.close();}
}
function fallbackRead(){try{return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');}catch{return [];}}
function fallbackWrite(xs){localStorage.setItem(FALLBACK_KEY,JSON.stringify(xs.slice(-MAX_FALLBACK)));}
export async function listSessions() {
  try{return (await transact('readonly',store=>store.getAll())).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));}
  catch{return fallbackRead().sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt));}
}
export async function saveSession(session) {
  const record={...session,id:session.id+'-'+(globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2))};
  try{await transact('readwrite',store=>store.put(record));}
  catch{fallbackWrite([...fallbackRead(),record]);}
  return record;
}
export async function deleteAllSessions() {
  try{await transact('readwrite',store=>store.clear());}catch{}
  try{localStorage.removeItem(FALLBACK_KEY);}catch{}
}
export async function importSessions(records) {
  if(!Array.isArray(records))throw new Error('Import must be an array');
  if(records.length>10000)throw new Error('Import exceeds 10,000 sessions');
  let count=0;
  for(const raw of records){
    const s=sanitizeImportedSession(raw);
    if(!s)continue;
    await saveSession(s); count++;
  }
  return count;
}
