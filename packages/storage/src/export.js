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
 * Export bundle shape (F19): `{ schema, exportedAt, sessions: [...], skillReviews: [...] }`. The
 * former array-of-sessions shape is still accepted on import. Only sessions were exported before;
 * per-skill review records add no personal identifiers and never leave the device except through
 * this explicit user action.
 */
export function exportBundle(sessions, skillReviews = []) {
  return {
    schema: 'zetamaster-export-v2',
    exportedAt: new Date().toISOString(),
    sessions: Array.isArray(sessions) ? sessions : [],
    skillReviews: Array.isArray(skillReviews) ? skillReviews : [],
  };
}
/** Accepts both export shapes (v1 array and v2 bundle); returns the session array or null. */
export function parseExportBundle(parsed) {
  if(Array.isArray(parsed)) return parsed;
  if(parsed && typeof parsed==='object' && Array.isArray(parsed.sessions)) return parsed.sessions;
  return null;
}
