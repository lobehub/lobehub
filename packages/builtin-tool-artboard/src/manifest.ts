import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ArtboardApiName, ArtboardIdentifier } from './types';

const OP_TYPES = [
  'addPage',
  'updatePage',
  'removePage',
  'addRound',
  'updateRound',
  'addGroup',
  'updateGroup',
  'removeGroup',
  'addBoard',
  'updateBoard',
  'removeBoard',
  'addEdge',
  'removeEdge',
  'setCheck',
];

const sourceSchema = {
  description:
    'What the board shows. Canvas: {kind:"canvas", canvasId, version?, path?}; version defaults to the latest, path picks a page of a multi-page Canvas. Image: {kind:"image", fileRef} with a file id from <file id> or an image ref from <image ref> in this conversation. A decision board has no source.',
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

const boardSchema = {
  properties: {
    expected: { type: 'string' },
    groupId: { type: 'string' },
    h: { type: 'number' },
    pageId: { type: 'string' },
    recommended: { type: 'boolean' },
    roundId: { type: 'string' },
    source: sourceSchema,
    title: { type: 'string' },
    type: { enum: ['html', 'image', 'video', 'decision'], type: 'string' },
    w: { type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
  type: 'object',
};

const opSchema = {
  description: [
    'One change. Fields per type:',
    'addPage {page:{name}}; updatePage {id, patch:{name}}; removePage {id} (only when empty, never the last page);',
    'addRound {round:{title, pageId?, batchId?}} opens one choice question, rounds sharing a batchId are submitted together; updateRound {id, patch:{title}};',
    'addGroup {group:{title, kind: journey|options|references|other, desc?, pageId?}};',
    'updateGroup {id, patch:{title?, kind?, desc?}}; removeGroup {id} (only when empty);',
    'addBoard {board:{title, x, y, w?, h?, groupId?, roundId?, pageId?, type?, source?, recommended?, expected?}}: x/y are page coordinates, size defaults to 640×400, type defaults from the source, type "decision" is a branch point with no source, roundId makes the board an option of that round and recommended marks your pick, expected is the acceptance check of a journey board;',
    'updateBoard {id, patch:{title?, x?, y?, w?, h?, groupId?, roundId?, source?, recommended?, expected?}} (groupId or roundId null detaches); removeBoard {id} (also removes its edges);',
    'addEdge {edge:{from, to, label?, condition?, isDefault?}} where label is what the user does in at most four words and is left out when the two screens already make the step obvious, condition is when a branch out of a decision board is taken and isDefault marks its fallback branch; removeEdge {id};',
    'setCheck {boardId, expected} for a journey board.',
    'pageId defaults to the first page. Add ops may set ref; later ops in the same call use that ref wherever an id is expected.',
  ].join(' '),
  properties: {
    board: boardSchema,
    boardId: { type: 'string' },
    edge: { type: 'object' },
    expected: { type: 'string' },
    group: { type: 'object' },
    id: { type: 'string' },
    page: { type: 'object' },
    patch: { properties: { source: sourceSchema }, type: 'object' },
    ref: { type: 'string' },
    round: { type: 'object' },
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
        "Create the artboard for a requirement task: groups of boards (Canvases or images), edges for the user journey, and rounds of options for the user to choose from. Without taskId it uses this run's task, or creates a task titled `title` in the current project. One task has at most one artboard.",
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
        'Read an artboard: its pages, rounds with the user’s submitted choices, groups, boards and edges, your open questions, the revision, the phase, and which boards show an older version of their Canvas.',
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
    {
      description:
        'List the unresolved comment threads on an artboard, with their replies and what each one is attached to. Threads returned here count as read by you.',
      name: ArtboardApiName.listArtboardComments,
      parameters: {
        additionalProperties: false,
        properties: { id: idSchema },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description: 'Reply in a comment thread on an artboard.',
      name: ArtboardApiName.replyArtboardComment,
      parameters: {
        additionalProperties: false,
        properties: {
          commentId: { description: 'Id of the thread, or of any comment in it.', type: 'string' },
          content: { description: 'Plain text.', type: 'string' },
        },
        required: ['commentId', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Mark a comment thread resolved once what it asks for is done, or once your question in it is answered.',
      name: ArtboardApiName.resolveArtboardComment,
      parameters: {
        additionalProperties: false,
        properties: {
          commentId: { description: 'Id of the first comment of the thread.', type: 'string' },
        },
        required: ['commentId'],
        type: 'object',
      },
    },
    {
      description:
        'Ask the user a question on the artboard as a new comment thread, attached to a board, a group or a page. The board cannot be finalized while the thread is unresolved.',
      name: ArtboardApiName.askArtboardQuestion,
      parameters: {
        additionalProperties: false,
        properties: {
          boardId: { description: 'Board the question is about.', type: 'string' },
          content: {
            description: 'The question in plain text, with your suggestion.',
            type: 'string',
          },
          groupId: { description: 'Group the question is about.', type: 'string' },
          id: idSchema,
          pageId: {
            description: 'Page the question is about; defaults to the first page.',
            type: 'string',
          },
        },
        required: ['id', 'content'],
        type: 'object',
      },
    },
  ],
  identifier: ArtboardIdentifier,
  meta: { avatar: '🎨', title: 'Artboard' },
  systemRole: systemPrompt,
  type: 'builtin',
};
