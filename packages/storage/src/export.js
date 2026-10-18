/** Explicit user action only; no uploads, analytics SDKs, or external requests. */
export function downloadJson(filename,data) {
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadCsv(filename,records) {
  const columns=['startedAt','mode','benchmark','score','elapsedMs','seed'];
  const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
  const csv=[columns.join(','),...records.map(s=>columns.map(k=>quote(s[k])).join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=document.createElement('a'); a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/**
 * Export bundle shape: v3 `{ schema, exportedAt, sessions, skillReviews, dailyPlans }` (F34);
 * v2 lacked dailyPlans; v1 was a bare session array. All three import shapes stay accepted. None
 * of these records carry personal identifiers or scores beyond the user's own sessions, and
 * exports never happen without this explicit user action.
 */
export function exportBundle(sessions, skillReviews = [], dailyPlans = []) {
  return {
    schema: 'zetamaster-export-v3',
    exportedAt: new Date().toISOString(),
    sessions: Array.isArray(sessions) ? sessions : [],
    skillReviews: Array.isArray(skillReviews) ? skillReviews : [],
    dailyPlans: Array.isArray(dailyPlans) ? dailyPlans : [],
  };
}
/** Accepts every export shape (v1 array, v2 bundle, v3 bundle); returns the session array or null. */
export function parseExportBundle(parsed) {
  if(Array.isArray(parsed)) return parsed;
  if(parsed && typeof parsed==='object' && Array.isArray(parsed.sessions)) return parsed.sessions;
  return null;
}
