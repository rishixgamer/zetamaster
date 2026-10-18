import { chooseAdaptive } from './drills.js';
import { weakestSkillCell, SKILL_MIN_SAMPLES } from './skills.js';
import { detectPlateau } from '../../analytics/src/progress.js';
export function dailyPlan(sessions, minutes=15) {
  const adaptive=chooseAdaptive(sessions);
  const plateau=detectPlateau(sessions);
  // F17 hook: surface the slowest reliably-observed skill pattern in the rationale only when such
  // data exists; otherwise degrade gracefully to the operation-level rationale. Scope 'all' is a
  // deliberate training-time choice (practice attempts are legitimate signals for *choosing*
  // practice); progress summaries stay benchmark-scoped separately (docs/SKILLS.md).
  const weak=weakestSkillCell(sessions,{ scope:'all', minSamples:SKILL_MIN_SAMPLES });
  const pattern=weak?` Slowest recorded pattern so far: ${weak.label} — ×${weak.ratio.toFixed(2)} vs your ${weak.op} median over ${weak.count} solves (small samples, descriptive only). Drill it from a heatmap cell or the due pattern reviews panel; each finished drill schedules the next repetition.`:'';
  return { targetMinutes:minutes, rationale:adaptive.explanation+pattern, steps:[
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
