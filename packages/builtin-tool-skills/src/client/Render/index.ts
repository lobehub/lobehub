import { SkillsApiName } from '../../types';
import ExecScript from './ExecScript';
import ReadReference from './ReadReference';
import RunSkill from './RunSkill';

export const SkillsRenders = {
  [SkillsApiName.execScript]: ExecScript,
  [SkillsApiName.readReference]: ReadReference,
  [SkillsApiName.runSkill]: RunSkill,
};
