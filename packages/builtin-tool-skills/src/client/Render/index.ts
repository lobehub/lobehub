import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';

import { SkillsApiName } from '../../types';
import ExecScript from './ExecScript';
import ReadReference from './ReadReference';
import RunSkill from './RunSkill';

export const SkillsRenders = {
  [SkillsApiName.execScript]: ExecScript,
  [SkillsApiName.readReference]: ReadReference,
  [SkillsApiName.runCommand]: RunCommandRender,
  [SkillsApiName.activateSkill]: RunSkill,
};
