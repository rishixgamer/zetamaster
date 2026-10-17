import { createRng, intBetween, sample } from '../../core/src/rng.js';
/** Separate distribution; NEVER contaminate Zetamac benchmark data. */
export function createQuantGenerator(seed='quant') {
  const rng=createRng(seed); let sequence=0;
  return () => {
    const op=sample(rng,['percentage','fraction','expected-value','basis-points']);
    const a=intBetween(rng,1,20), b=intBetween(rng,1,20);
    const variants={
      percentage:()=>({expression:`${a*5}% of ${b*20}`,answer:a*b}),
      fraction:()=>({expression:`${a*b}/${b} = ?`,answer:a}),
      'expected-value':()=>({expression:`50% chance of +${a*2}, otherwise −${b*2}. EV?`,answer:a-b}),
      'basis-points':()=>({expression:`${a*10} basis points as a percentage?`,answer:a/10}),
    };
    return {id:`quant-${++sequence}`,op,...variants[op](),mode:'quant'};
  };
}
