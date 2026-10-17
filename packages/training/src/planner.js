import { chooseAdaptive } from './drills.js';
import { detectPlateau } from '../../analytics/src/progress.js';
export function dailyPlan(sessions, minutes=15) {
  const adaptive=chooseAdaptive(sessions);
  const plateau=detectPlateau(sessions);
  return { targetMinutes:minutes, rationale:adaptive.explanation, steps:[
    {title:'Recall warm-up',minutes:2,mode:'isolation',operation:'mul'},
    {title:`Targeted ${adaptive.primary} practice`,minutes:5,mode:'adaptive'},
    {title:'Technique lesson',minutes:3,mode:'curriculum'},
    {title:'Mixed sprint',minutes:3,mode:'sprint'},
    {title:'Review and reflect',minutes:2,mode:'review'},
  ],plateau:plateau.status };
}
export function candidatePriority({frequency,excessMs,trainability,practiceMinutes}) {
  if(practiceMinutes<=0) return 0;
  return Math.max(0, frequency)*Math.max(0,excessMs)*Math.max(0,trainability)/practiceMinutes;
}
