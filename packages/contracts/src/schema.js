/** Shared runtime vocabulary for future API/db integrations. Schema evolution is explicit. */
export const SCHEMA_VERSION=1;
export const MODE_NAMESPACE=Object.freeze({benchmark:'arithmetic-standard',custom:'arithmetic-practice',adaptive:'arithmetic-practice',isolation:'arithmetic-practice',sprint:'arithmetic-practice',endurance:'arithmetic-practice',replay:'arithmetic-practice',drill:'arithmetic-practice',quant:'quant-practice'});
export const FEATURE_STATE=Object.freeze(['implemented','partial','planned']);
/** @typedef {{id:string,op:'add'|'sub'|'mul'|'div',sourceLeft:number,sourceRight:number,left:number,right:number,answer:number,tags:string[]}} Question */
/** @typedef {{startedAt:string,mode:string,score:number,elapsedMs:number,benchmark:boolean,events:Array<object>}} SessionRecord */
/** @typedef {{id:string, title:string, operation:string, steps:string[], result:number}} Lesson */
/** @typedef {{skills:Array<string>,goalDurationMs:number,questionCount?:number,seed:string}} TrainingPrescription */
