import { SkillStoreApiName } from '../../types';
import { ImportFromMarketInspector } from './ImportFromMarket';
import { ImportSkillInspector } from './ImportSkill';
import { SearchSkillInspector } from './SearchSkill';

export const SkillStoreInspectors = {
  [SkillStoreApiName.importFromMarket]: ImportFromMarketInspector,
  [SkillStoreApiName.importSkill]: ImportSkillInspector,
  [SkillStoreApiName.searchSkill]: SearchSkillInspector,
};
