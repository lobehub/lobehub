export enum RecommendedSkillType {
  Klavis = 'klavis',
  Lobehub = 'lobehub',
}

export interface RecommendedSkillItem {
  id: string;
  type: RecommendedSkillType;
}

export const RECOMMENDED_SKILLS: RecommendedSkillItem[] = [
  { id: 'gmail', type: RecommendedSkillType.Klavis },
  { id: 'notion', type: RecommendedSkillType.Klavis },
  { id: 'google-drive', type: RecommendedSkillType.Klavis },
  { id: 'google-calendar', type: RecommendedSkillType.Klavis },
  { id: 'slack', type: RecommendedSkillType.Klavis },
];
