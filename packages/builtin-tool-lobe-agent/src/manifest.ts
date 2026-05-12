import type { BuiltinToolManifest } from '@lobechat/types';

import { isDesktop } from './const';
import { systemPrompt } from './systemRole';
import { LobeAgentApiName, LobeAgentIdentifier } from './types';

export const LobeAgentManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Analyze images or videos selected by visual file refs or direct media URLs and answer a visual question. Prefer the active model's native multimodal capability when it can inspect the visual media directly; use this tool only as a fallback when the active model cannot inspect the requested images or videos. Provide either refs or urls; at least one is required. Prefer refs when stable refs are available in <files_info>, such as msg_xxx.image_1 or msg_xxx.video_1, and use urls only for direct media URLs that are not available as message refs. After this tool returns, answer the user directly with the result.",
      name: LobeAgentApiName.analyzeVisualMedia,
      parameters: {
        additionalProperties: false,
        properties: {
          question: {
            description: 'The visual question or task to answer.',
            type: 'string',
          },
          refs: {
            description:
              'Stable visual file ref strings to analyze, such as ["msg_xxx.image_1"] or ["msg_xxx.video_1"].',
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
          urls: {
            description: 'Direct image or video URLs to analyze when no message file ref exists.',
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
        },
        required: ['question'],
        type: 'object',
      },
    },

    // ==================== Sub-Agent ====================
    {
      description:
        'Dispatch a single sub-agent that runs in an isolated context to handle a long-running, multi-step request. Use this when the request requires extended processing (web research, multi-source synthesis, deep investigation) that benefits from running independently of the main conversation.',
      name: LobeAgentApiName.callSubAgent,
      parameters: {
        properties: {
          description: {
            description: 'Brief description of what this sub-agent does (shown in UI).',
            type: 'string',
          },
          instruction: {
            description: 'Detailed instruction/prompt for the sub-agent execution.',
            type: 'string',
          },
          inheritMessages: {
            description:
              'Whether to inherit context messages from the parent conversation. Default is false.',
            type: 'boolean',
          },
          ...(isDesktop && {
            runInClient: {
              description:
                'Whether to run on the desktop client (for local file/shell access). MUST be true when the sub-agent requires local-system tools. Default is false (server execution).',
              type: 'boolean',
            },
          }),
          timeout: {
            description: 'Optional timeout in milliseconds. Default is 30 minutes.',
            type: 'number',
          },
        },
        required: ['description', 'instruction'],
        type: 'object',
      },
    },
    {
      description:
        'Dispatch one or more sub-agents in parallel. Each sub-agent runs in an isolated context. Use this when several independent investigations / multi-step tasks should proceed concurrently.',
      name: LobeAgentApiName.callSubAgents,
      parameters: {
        properties: {
          tasks: {
            description: 'Array of sub-agents to dispatch.',
            items: {
              properties: {
                description: {
                  description: 'Brief description of what this sub-agent does (shown in UI).',
                  type: 'string',
                },
                instruction: {
                  description: 'Detailed instruction/prompt for the sub-agent execution.',
                  type: 'string',
                },
                inheritMessages: {
                  description:
                    'Whether to inherit context messages from the parent conversation. Default is false.',
                  type: 'boolean',
                },
                ...(isDesktop && {
                  runInClient: {
                    description:
                      'Whether to run on the desktop client (for local file/shell access). MUST be true when the sub-agent requires local-system tools. Default is false (server execution).',
                    type: 'boolean',
                  },
                }),
                timeout: {
                  description: 'Optional timeout in milliseconds. Default is 30 minutes.',
                  type: 'number',
                },
              },
              required: ['description', 'instruction'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['tasks'],
        type: 'object',
      },
    },
  ],
  identifier: LobeAgentIdentifier,
  meta: {
    avatar: '🤖',
    description: 'Run built-in Lobe Agent capabilities, including dispatching sub-agents.',
    readme: 'Lobe Agent provides built-in assistant capabilities that can be expanded over time.',
    title: 'Lobe Agent',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
