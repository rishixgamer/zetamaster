import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=resolve('.');
const entry=resolve('apps/web/src/main.js');
const visited=new Set();
let errors=0;
async function scan(file){
 if(visited.has(file))return;visited.add(file);
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/(?:import|export)\s+(?:[^;]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)){
   const target=resolve(dirname(file),match[1]);
   if(!target.startsWith(root+'/') || !(await stat(target).catch(()=>null))?.isFile()){
     console.error(`Missing module: ${file}: ${match[1]}`);errors++;continue;
   }
   await scan(target);
 }
}
await scan(entry);
if(errors)process.exitCode=1;else console.log(`Browser import graph verified: ${visited.size} modules.`);
