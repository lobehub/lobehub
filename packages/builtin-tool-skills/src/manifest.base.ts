import type { LobeChatPluginApi } from '@lobechat/types';

import { SkillsApiName } from './types';

export const activateSkillApi: LobeChatPluginApi = {
  description:
    'Activate a skill by name to load its instructions. Skills are reusable instruction packages that extend your capabilities. Returns the skill content that you should follow to complete the task. If the skill is not found, returns a list of available skills.',
  name: SkillsApiName.activateSkill,
  parameters: {
    properties: {
      name: {
        description: 'The exact name of the skill to activate.',
        type: 'string',
      },
    },
    required: ['name'],
    type: 'object',
  },
};

export const readReferenceApi: LobeChatPluginApi = {
  description:
    "Read a reference file attached to a skill. Use this to load additional context files mentioned in a skill's content. Requires the id returned by activateSkill and the file path.",
  name: SkillsApiName.readReference,
  parameters: {
    properties: {
      id: {
        description: 'The skill ID or name returned by activateSkill.',
        type: 'string',
      },
      path: {
        description:
          'The virtual path of the reference file to read. Must be a path mentioned in the skill content.',
        type: 'string',
      },
    },
    required: ['id', 'path'],
    type: 'object',
  },
};

export const exportFileApi: LobeChatPluginApi = {
  description:
    'Export a file generated during skill execution to cloud storage. Use this to save outputs, results, or generated files for the user to download. The file will be uploaded and a permanent download URL will be returned.',
  name: SkillsApiName.exportFile,
  parameters: {
    properties: {
      filename: {
        description: 'The name for the exported file (e.g., "result.csv", "output.pdf")',
        type: 'string',
      },
      path: {
        description:
          'The path of the file in the skill execution environment to export (e.g., "./output/result.csv")',
        type: 'string',
      },
    },
    required: ['path', 'filename'],
    type: 'object',
  },
};

export const runCommandApi: LobeChatPluginApi = {
  description:
    'Execute a shell command. Returns the command output, stderr, and exit code. Note: Default shell is /bin/sh (dash/ash), not bash. The `source` command may not work; use `bash -c "source file && cmd"` if needed.',
  humanIntervention: 'required',
  name: SkillsApiName.runCommand,
  parameters: {
    properties: {
      command: {
        description:
          'The shell command to execute. Note: Default shell is /bin/sh, not bash. Use `bash -c "..."` for bash-specific features.',
        type: 'string',
      },
      description: {
        description:
          'Clear description of what this command does (5-10 words, in active voice). Use the same language as the user input.',
        type: 'string',
      },
    },
    required: ['command'],
    type: 'object',
  },
};

export const execScriptBaseParams = {
  command: {
    description:
      'The shell command to execute. Note: Default shell is /bin/sh, not bash. Use `bash -c "..."` for bash-specific features like `source`.',
    type: 'string' as const,
  },
  description: {
    description:
      'Clear description of what this command does (5-10 words, in active voice). Use the same language as the user input.',
    type: 'string' as const,
  },
};

export const manifestMeta = {
  avatar: '🛠️',
  description: 'Activate and use reusable skill packages',
  title: 'Skills',
};
