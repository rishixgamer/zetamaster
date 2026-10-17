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
