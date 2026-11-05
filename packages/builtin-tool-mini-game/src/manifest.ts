import type { BuiltinToolManifest } from '@lobechat/types';

import { PIXEL_YARD_SCENE } from './scene';
import { systemPrompt } from './systemRole';
import { MiniGameApiName, MiniGameIdentifier } from './types';

/** Walking across the yard takes a few seconds; leave room for a slow tab. */
const WALK_TIMEOUT_MS = 60_000;

const targetIdProperty = {
  description: 'Object id from the game state, e.g. bench_1 or pond_1.',
  type: 'string',
};

export const MiniGameManifest: BuiltinToolManifest = {
  api: [
    {
      defaultTimeoutMs: 5000,
      description:
        'Read the current yard: your position, pose and activity, and every object with its id and supported actions.',
      name: MiniGameApiName.getGameState,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      defaultTimeoutMs: WALK_TIMEOUT_MS,
      description:
        'Walk to an object (by id) or to a grid cell and stand there. Stands up first if you are sitting. Returns after you arrive.',
      name: MiniGameApiName.moveTo,
      parameters: {
        additionalProperties: false,
        properties: {
          targetId: targetIdProperty,
          x: {
            description: 'Grid column; use with y when there is no object to walk to.',
            maximum: PIXEL_YARD_SCENE.size.width - 1,
            minimum: 0,
            type: 'integer',
          },
          y: {
            description: 'Grid row; use with x.',
            maximum: PIXEL_YARD_SCENE.size.height - 1,
            minimum: 0,
            type: 'integer',
          },
        },
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: WALK_TIMEOUT_MS,
      description:
        'Walk to an object whose actions include sitOn (the bench) and sit down on it. Returns after you are seated.',
      name: MiniGameApiName.sitOn,
      parameters: {
        additionalProperties: false,
        properties: { targetId: targetIdProperty },
        required: ['targetId'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: WALK_TIMEOUT_MS,
      description:
        'Walk to an object whose actions include watch (the pond, the lamp, the vegetable patch) and keep watching it. Returns after you arrive and start watching.',
      name: MiniGameApiName.watch,
      parameters: {
        additionalProperties: false,
        properties: { targetId: targetIdProperty },
        required: ['targetId'],
        type: 'object',
      },
    },
  ],
  // Runs only in the browser tab that hosts the game; see `browserExecutedToolIds`.
  executors: ['client'],
  identifier: MiniGameIdentifier,
  meta: {
    avatar: '🏡',
    description: 'Move your character around the mini game yard',
    title: 'Mini Game',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
