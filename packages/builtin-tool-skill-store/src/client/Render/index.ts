import { SkillStoreApiName } from '../../types';
import ImportSkill from './ImportSkill';
import SearchSkill from './SearchSkill';

export const SkillStoreRenders = {
  [SkillStoreApiName.importFromMarket]: ImportSkill,
  [SkillStoreApiName.importSkill]: ImportSkill,
  [SkillStoreApiName.searchSkill]: SearchSkill,
};
