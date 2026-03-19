import { SkillsApiName } from '../../types';
import ExecScript from './ExecScript';
import ReadReference from './ReadReference';
import RunCommand from './RunCommand';
import RunSkill from './RunSkill';

export const SkillsRenders = {
  [SkillsApiName.execScript]: ExecScript,
  [SkillsApiName.readReference]: ReadReference,
  [SkillsApiName.runCommand]: RunCommand,
  [SkillsApiName.activateSkill]: RunSkill,
};
