import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ArtboardApiName, ArtboardIdentifier } from './types';

const OP_TYPES = [
  'addGroup',
  'updateGroup',
  'removeGroup',
  'addFrame',
  'updateFrame',
  'removeFrame',
  'addArrow',
  'removeArrow',
  'addNote',
  'updateNote',
  'removeNote',
  'setCheck',
  'decideQuestion',
];

const sourceSchema = {
  description:
    'What the frame shows. Canvas: {kind:"canvas", canvasId, version?, path?}; version defaults to the latest, path picks a page of a multi-page Canvas. Image: {kind:"image", fileRef} with a file id from <file id> or an image ref from <image ref> in this conversation.',
  properties: {
    canvasId: { type: 'string' },
    fileRef: { type: 'string' },
    kind: { enum: ['canvas', 'image'], type: 'string' },
    path: { type: 'string' },
    version: { type: 'integer' },
  },
  required: ['kind'],
  type: 'object',
};

const opSchema = {
  description: [
    'One change. Fields per type:',
    'addGroup {group:{title, kind: journey|options|references|other, desc?}};',
    'updateGroup {id, patch:{title?, kind?, desc?}}; removeGroup {id} (only when empty);',
    'addFrame {frame:{groupId, title, x, y, source, recommended?, check?:{expected}}};',
    'updateFrame {id, patch:{groupId?, title?, x?, y?, source?, recommended?}}; removeFrame {id} (also removes its arrows);',
    'addArrow {arrow:{from, to, label}} where label is what the user does; removeArrow {id};',
    'addNote {note:{kind: title|subtitle|sticky, text, x, y, w?, question?:{suggestion?}}} (only a sticky asks a question);',
    'updateNote {id, patch:{text?, x?, y?, w?, question?}}; removeNote {id};',
    'setCheck {frameId, expected} for a journey frame; decideQuestion {noteId, decision}.',
    'Add ops may set ref; later ops in the same call use that ref wherever an id is expected.',
  ].join(' '),
  properties: {
    arrow: { type: 'object' },
    decision: { type: 'string' },
    expected: { type: 'string' },
    frame: {
      properties: { source: sourceSchema },
      type: 'object',
    },
    frameId: { type: 'string' },
    group: { type: 'object' },
    id: { type: 'string' },
    note: { type: 'object' },
    noteId: { type: 'string' },
    patch: { type: 'object' },
    ref: { type: 'string' },
    type: { enum: OP_TYPES, type: 'string' },
  },
  required: ['type'],
  type: 'object',
};

const idSchema = {
  description: 'Artboard id returned by createArtboard or listArtboards.',
  type: 'string',
};

export const ArtboardManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Create the artboard for a requirement task: groups of frames (Canvases or images), arrows for the user journey, and sticky notes with open questions. Without taskId it uses this run's task, or creates a task titled `title` in the current project. One task has at most one artboard.",
      name: ArtboardApiName.createArtboard,
      parameters: {
        additionalProperties: false,
        properties: {
          description: { description: 'One line shown on the board card.', type: 'string' },
          ops: {
            description: 'Initial content, built with the same ops as updateArtboard.',
            items: opSchema,
            type: 'array',
          },
          taskId: { description: 'Task id or identifier such as PRJ-12.', type: 'string' },
          title: { description: 'Board title, usually the requirement.', type: 'string' },
        },
        required: ['title'],
        type: 'object',
      },
    },
    {
      description:
        'Apply ops to an artboard. Either every op applies or none does. Pass the revision you last read; a stale revision is refused, so call readArtboard and retry.',
      name: ArtboardApiName.updateArtboard,
      parameters: {
        additionalProperties: false,
        properties: {
          id: idSchema,
          ops: { items: opSchema, type: 'array' },
          revision: { description: 'Revision from the last read or write.', type: 'integer' },
        },
        required: ['id', 'revision', 'ops'],
        type: 'object',
      },
    },
    {
      description:
        'Read an artboard: its groups, frames, arrows and notes, the revision, the phase, and which frames show an older version of their Canvas.',
      name: ArtboardApiName.readArtboard,
      parameters: {
        additionalProperties: false,
        properties: { id: idSchema },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description: 'List the artboards in the current project.',
      name: ArtboardApiName.listArtboards,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
  ],
  identifier: ArtboardIdentifier,
  meta: { avatar: '🎨', title: 'Artboard' },
  systemRole: systemPrompt,
  type: 'builtin',
};
