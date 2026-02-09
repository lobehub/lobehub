import { BuiltinToolManifest } from '@lobechat/types';

import { isDesktop } from './const';
import { systemPrompt } from './systemRole';
import { SkillsApiName, SkillsIdentifier } from './types';

export const SkillsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Activate a skill by name to load its instructions. Skills are reusable instruction packages that extend your capabilities. Returns the skill content that you should follow to complete the task. If the skill is not found, returns a list of available skills.',
      name: SkillsApiName.runSkill,
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
    },
    {
      description:
        "Read a reference file attached to a skill. Use this to load additional context files mentioned in a skill's content. Requires the id returned by runSkill and the file path.",
      name: SkillsApiName.readReference,
      parameters: {
        properties: {
          id: {
            description: 'The skill ID or name returned by runSkill.',
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
    },
    {
      description:
        "Execute a shell command or script specified in a skill's instructions. Use this when a skill's content instructs you to run CLI commands (e.g., npx, npm, pip). IMPORTANT: Always include the 'config' parameter with the current skill's id and name (obtained from runSkill's state) so the system can locate skill resources. Returns the command output.",
      humanIntervention: 'required',
      name: SkillsApiName.execScript,
      parameters: {
        properties: {
          command: {
            description: 'The shell command to execute.',
            type: 'string',
          },
          config: {
            description:
              'REQUIRED: Current skill context. Must include the id and name from the most recent runSkill call. The server uses this to locate skill resources (e.g., ZIP package for skill files). Example: { "id": "skill_xxx", "name": "skill-name", "description": "..." }',
            properties: {
              description: {
                description: "Current skill's description (optional)",
                type: 'string',
              },
              id: {
                description: "Current skill's ID from runSkill state (required for resource lookup)",
                type: 'string',
              },
              name: {
                description: "Current skill's name from runSkill state (required for resource lookup)",
                type: 'string',
              },
            },
            type: 'object',
          },
          description: {
            description:
              'Clear description of what this command does (5-10 words, in active voice). Use the same language as the user input.',
            type: 'string',
          },
          ...(isDesktop && {
            runInClient: {
              description:
                'Whether to run on the desktop client (for local shell access). MUST be true when command requires local-system tools. Default is false (cloud sandbox execution).',
              type: 'boolean',
            },
          }),
        },
        required: ['description', 'command'],
        type: 'object',
      },
    },
    {
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
    },
    {
      description:
        'Import/install a skill from a URL. Supports SKILL.md URLs, GitHub repository URLs, and ZIP package URLs. Requires user confirmation before installation.',
      humanIntervention: 'required',
      name: SkillsApiName.importSkill,
      parameters: {
        properties: {
          type: {
            description:
              'The type of the URL: "url" for SKILL.md or GitHub links, "zip" for ZIP package URLs.',
            enum: ['url', 'zip'],
            type: 'string',
          },
          url: {
            description: 'The URL of the skill resource to import.',
            type: 'string',
          },
        },
        required: ['url', 'type'],
        type: 'object',
      },
    },
  ],
  identifier: SkillsIdentifier,
  meta: {
    avatar: '🛠️',
    description: 'Activate and use reusable skill packages',
    title: 'Skills',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
