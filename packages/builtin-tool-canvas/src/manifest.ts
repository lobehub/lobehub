import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CanvasApiName, CanvasIdentifier } from './types';

const canvasIdSchema = {
  description: 'Canvas id returned by createCanvas or listCanvases.',
  type: 'string',
};

const fileWriteSchema = {
  additionalProperties: false,
  properties: {
    content: {
      description:
        'Full file content. Base64 when encoding is "base64". Omit when fileRef is given.',
      type: 'string',
    },
    encoding: {
      description: 'Use "base64" for small generated binary assets. Defaults to utf8.',
      enum: ['utf8', 'base64'],
      type: 'string',
    },
    fileRef: {
      description:
        'Copy an existing file into the project instead of writing content: a file id from <file id="..."> or a media ref from <image ref="..."> in this conversation.',
      type: 'string',
    },
    path: {
      description: 'Project-relative path, e.g. "index.html" or "img/logo.png".',
      type: 'string',
    },
  },
  required: ['path'],
  type: 'object',
};

export const CanvasManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Return the Canvas rules and the full component reference. Call once per conversation before createCanvas or updateCanvas; they are refused until you have.',
      name: CanvasApiName.readCanvasGuide,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description:
        'Create a Canvas from project files. The project needs index.html. Files are validated against the component reference; a rejected save lists each problem as file:line and creates nothing.',
      name: CanvasApiName.createCanvas,
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description: 'One-line summary shown on the card, e.g. the conclusion.',
            type: 'string',
          },
          files: { description: 'Project files.', items: fileWriteSchema, type: 'array' },
          title: { description: 'Short title shown on the card.', type: 'string' },
        },
        required: ['title', 'files'],
        type: 'object',
      },
    },
    {
      description:
        'Change an existing Canvas. Edits replace exact text (oldText must appear exactly once in the file), writes replace or add whole files, deletes remove files. Applied together as one new version; a rejected save changes nothing.',
      name: CanvasApiName.updateCanvas,
      parameters: {
        additionalProperties: false,
        properties: {
          canvasId: canvasIdSchema,
          deletes: { description: 'Paths to delete.', items: { type: 'string' }, type: 'array' },
          description: { description: 'New one-line summary.', type: 'string' },
          edits: {
            description: 'Exact-text replacements.',
            items: {
              additionalProperties: false,
              properties: {
                newText: { type: 'string' },
                oldText: {
                  description: 'Text to replace; must appear exactly once.',
                  type: 'string',
                },
                path: { type: 'string' },
              },
              required: ['path', 'oldText', 'newText'],
              type: 'object',
            },
            type: 'array',
          },
          title: { description: 'New title.', type: 'string' },
          writes: {
            description: 'Whole files to add or replace.',
            items: fileWriteSchema,
            type: 'array',
          },
        },
        required: ['canvasId'],
        type: 'object',
      },
    },
    {
      description:
        "Read a Canvas's file list and the contents of its text files. Pass paths to read only some files.",
      name: CanvasApiName.readCanvas,
      parameters: {
        additionalProperties: false,
        properties: {
          canvasId: canvasIdSchema,
          paths: {
            description: 'Files to read. Defaults to every text file.',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['canvasId'],
        type: 'object',
      },
    },
    {
      description: 'List the Canvases this agent has made, newest first.',
      name: CanvasApiName.listCanvases,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
  ],
  executors: ['server'],
  identifier: CanvasIdentifier,
  meta: {
    avatar: '🖼️',
    description:
      'Default for reports, analyses, comparisons and data dashboards: a versioned page built from LobeHub components that the user can revisit and publish. Prefer it over inline HTML or Artifacts for these',
    title: 'Canvas',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
