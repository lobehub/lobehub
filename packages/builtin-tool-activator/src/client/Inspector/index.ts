import { ActivatorApiName } from '../../types';
import { ActivateSkillInspector } from './ActivateSkill';
import { ActivateToolsInspector } from './ActivateTools';

export const LobeActivatorInspectors = {
  [ActivatorApiName.activateSkill]: ActivateSkillInspector,
  [ActivatorApiName.activateTools]: ActivateToolsInspector,
};
