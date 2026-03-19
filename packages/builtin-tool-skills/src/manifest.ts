import type { BuiltinToolManifest } from '@lobechat/types';

import {
  activateSkillApi,
  execScriptBaseParams,
  exportFileApi,
  manifestMeta,
  readReferenceApi,
  runCommandApi,
} from './manifest.base';
import { systemPrompt } from './systemRole';
import { SkillsApiName, SkillsIdentifier } from './types';

export const SkillsManifest: BuiltinToolManifest = {
  api: [
    activateSkillApi,
    readReferenceApi,
    runCommandApi,
    {
      description:
        "Execute a shell command or script specified in a skill's instructions. Use this when a skill's content instructs you to run CLI commands (e.g., npx, npm, pip). The system automatically uses the current skill context from the most recent runSkill call. Returns the command output.",
      humanIntervention: 'required',
      name: SkillsApiName.execScript,
      parameters: {
        properties: execScriptBaseParams,
        required: ['description', 'command'],
        type: 'object',
      },
    },
    exportFileApi,
  ],
  identifier: SkillsIdentifier,
  meta: manifestMeta,
  systemRole: systemPrompt,
  type: 'builtin',
};
