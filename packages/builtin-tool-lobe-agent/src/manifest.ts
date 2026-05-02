import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { LobeAgentApiName, LobeAgentIdentifier } from './types';

export const LobeAgentManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Analyze images or videos selected by visual file refs or direct media URLs and answer a visual question. Prefer the active model's native multimodal capability when it can inspect the visual media directly; use this tool only as a fallback when the active model cannot inspect the requested images or videos. Use only stable refs shown in <files_info>, such as msg_xxx.image_1 or msg_xxx.video_1. Pass refs for message attachments, or urls for direct media URLs that are not available as message refs. After this tool returns, answer the user directly with the result.",
      name: LobeAgentApiName.analyzeVisualMedia,
      parameters: {
        additionalProperties: false,
        anyOf: [{ required: ['refs'] }, { required: ['urls'] }],
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
  ],
  identifier: LobeAgentIdentifier,
  meta: {
    avatar: '🤖',
    description: 'Run built-in Lobe Agent capabilities.',
    readme: 'Lobe Agent provides built-in assistant capabilities that can be expanded over time.',
    title: 'Lobe Agent',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
