export const LESSONS = [
  {id:'addition-round',operation:'add',title:'Round and compensate',example:'68 + 47',steps:['68 + 50 = 118','118 − 3 = 115'],result:115,tags:['round-tens']},
  {id:'addition-left',operation:'add',title:'Left-to-right addition',example:'47 + 28',steps:['40 + 20 = 60','7 + 8 = 15','60 + 15 = 75'],result:75,tags:['carry-or-borrow']},
  {id:'subtraction-round',operation:'sub',title:'Subtract a round number',example:'82 − 47',steps:['82 − 50 = 32','32 + 3 = 35'],result:35,tags:['carry-or-borrow']},
  {id:'subtraction-complement',operation:'sub',title:'Think in complements',example:'100 − 68',steps:['68 + 30 = 98','98 + 2 = 100','30 + 2 = 32'],result:32,tags:['round-tens']},
  {id:'multiply-nine',operation:'mul',title:'Multiply by 9',example:'78 × 9',steps:['78 × 10 = 780','780 − 78 = 702'],result:702,tags:['table-9','shortcut-friendly']},
  {id:'multiply-distribute',operation:'mul',title:'Split tens and units',example:'7 × 48',steps:['7 × 40 = 280','7 × 8 = 56','280 + 56 = 336'],result:336,tags:['two-digit-decomposition']},
  {id:'multiply-five',operation:'mul',title:'Multiply by 5',example:'86 × 5',steps:['86 × 10 = 860','860 ÷ 2 = 430'],result:430,tags:['table-5']},
  {id:'multiply-eleven',operation:'mul',title:'Multiply by 11',example:'43 × 11',steps:['43 × 10 = 430','430 + 43 = 473'],result:473,tags:['table-11']},
  {id:'multiply-halve',operation:'mul',title:'Double and halve',example:'25 × 48',steps:['25 × 4 = 100','48 ÷ 4 = 12','100 × 12 = 1200'],result:1200,tags:['friendly-ending']},
  {id:'divide-inverse',operation:'div',title:'Reverse multiplication',example:'672 ÷ 7',steps:['7 × 100 = 700','700 − 672 = 28','28 = 7 × 4','100 − 4 = 96'],result:96,tags:['table-7']},
  {id:'divide-factor',operation:'div',title:'Factor the divisor',example:'288 ÷ 8',steps:['Divide by 2 three times','288 → 144 → 72 → 36'],result:36,tags:['table-8']},
  {id:'divide-estimate',operation:'div',title:'Estimate and adjust',example:'594 ÷ 9',steps:['9 × 70 = 630','Difference = 36 = 9 × 4','70 − 4 = 66'],result:66,tags:['table-9']},
];
export function lessonsFor(operation) {return operation?LESSONS.filter(l=>l.operation===operation):LESSONS;}
