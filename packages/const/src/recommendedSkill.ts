export enum RecommendedSkillType {
  Builtin = 'builtin',
  Klavis = 'klavis',
  Lobehub = 'lobehub',
}

export interface RecommendedSkillItem {
  id: string;
  type: RecommendedSkillType;
}

export const RECOMMENDED_SKILLS: RecommendedSkillItem[] = [
  // Builtin skills
  { id: 'lobe-artifacts', type: RecommendedSkillType.Builtin },
  { id: 'lobe-user-memory', type: RecommendedSkillType.Builtin },
  { id: 'lobe-cloud-sandbox', type: RecommendedSkillType.Builtin },
  { id: 'lobe-gtd', type: RecommendedSkillType.Builtin },
  { id: 'lobe-notebook', type: RecommendedSkillType.Builtin },
  // Klavis skills
  { id: 'gmail', type: RecommendedSkillType.Klavis },
  { id: 'notion', type: RecommendedSkillType.Klavis },
  { id: 'google-drive', type: RecommendedSkillType.Klavis },
  { id: 'google-calendar', type: RecommendedSkillType.Klavis },
  { id: 'slack', type: RecommendedSkillType.Klavis },
];
