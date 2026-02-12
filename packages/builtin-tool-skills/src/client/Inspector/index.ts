import { SkillsApiName } from '../../types';
import { ExecScriptInspector } from './ExecScript';
import { ImportSkillInspector } from './ImportSkill';
import { ReadReferenceInspector } from './ReadReference';
import { RunSkillInspector } from './RunSkill';

export const SkillsInspectors = {
  [SkillsApiName.execScript]: ExecScriptInspector,
  [SkillsApiName.importSkill]: ImportSkillInspector,
  [SkillsApiName.readReference]: ReadReferenceInspector,
  [SkillsApiName.runSkill]: RunSkillInspector,
};
