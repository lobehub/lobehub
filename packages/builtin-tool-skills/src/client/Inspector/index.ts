import { SkillsApiName } from '../../types';
import { ExecScriptInspector } from './ExecScript';
import { ReadReferenceInspector } from './ReadReference';
import { RunSkillInspector } from './RunSkill';

export const SkillsInspectors = {
  [SkillsApiName.execScript]: ExecScriptInspector,
  [SkillsApiName.readReference]: ReadReferenceInspector,
  [SkillsApiName.runSkill]: RunSkillInspector,
};
