/** Balanced, seeded A/B assignment; outcome analysis is future work. */
export function assignStrategyTrial(participantSeed, index) {
  let h=0; for(const ch of String(participantSeed))h=((h<<5)-h+ch.charCodeAt(0))|0;
  return ((Math.abs(h)+index)%2===0)?'A':'B';
}
