import { SkillsApiName } from '../../types';
import ExecScript from './ExecScript';
import ImportSkill from './ImportSkill';
import ReadReference from './ReadReference';
import RunSkill from './RunSkill';

export const SkillsRenders = {
  [SkillsApiName.execScript]: ExecScript,
  [SkillsApiName.importSkill]: ImportSkill,
  [SkillsApiName.readReference]: ReadReference,
  [SkillsApiName.runSkill]: RunSkill,
};
