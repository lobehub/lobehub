import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { PersonalPagesApiName, PersonalPagesIdentifier } from './types';

export const PersonalPagesManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a new personal page for the user. Personal pages are standalone cross-conversation documents, not tied to any agent.',
      name: PersonalPagesApiName.createPage,
      parameters: {
        properties: {
          content: {
            description: 'Page content in markdown or plain text.',
            type: 'string',
          },
          title: {
            description: 'Page title.',
            type: 'string',
          },
        },
        required: ['title', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Read an existing personal page by ID. Prefer XML format before node-level edits because XML includes stable node IDs.',
      name: PersonalPagesApiName.readPage,
      parameters: {
        properties: {
          format: {
            default: 'xml',
            description:
              'The format to return. Use "xml" for node-level edits, "markdown" for plain text, or "both". Defaults to "xml".',
            enum: ['xml', 'markdown', 'both'],
            type: 'string',
          },
          id: {
            description: 'Target page ID.',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      },
    },
    {
      description:
        'Replace the entire content of an existing personal page by ID. Use this only when overwriting most or all of the page. Prefer modifyNodes for targeted edits.',
      name: PersonalPagesApiName.replaceContent,
      parameters: {
        properties: {
          content: {
            description: 'New full page content.',
            type: 'string',
          },
          id: {
            description: 'Target page ID.',
            type: 'string',
          },
        },
        required: ['id', 'content'],
        type: 'object',
      },
    },
    {
      description:
        'Perform LiteXML node operations (insert, modify, remove) on a personal page by ID. Use this for content edits after reading the page in XML format.',
      name: PersonalPagesApiName.modifyNodes,
      parameters: {
        properties: {
          id: {
            description: 'Target page ID.',
            type: 'string',
          },
          operations: {
            description:
              'Array of node operations. For insert, provide beforeId or afterId plus LiteXML without an id. For modify, provide LiteXML with existing node IDs. For remove, provide the node id.',
            items: {
              oneOf: [
                {
                  properties: {
                    action: { const: 'insert', type: 'string' },
                    beforeId: { description: 'ID of the node to insert before.', type: 'string' },
                    litexml: { description: 'LiteXML node to insert.', type: 'string' },
                  },
                  required: ['action', 'beforeId', 'litexml'],
                  type: 'object',
                },
                {
                  properties: {
                    action: { const: 'insert', type: 'string' },
                    afterId: { description: 'ID of the node to insert after.', type: 'string' },
                    litexml: { description: 'LiteXML node to insert.', type: 'string' },
                  },
                  required: ['action', 'afterId', 'litexml'],
                  type: 'object',
                },
                {
                  properties: {
                    action: { const: 'modify', type: 'string' },
                    litexml: {
                      description:
                        'LiteXML string or array of strings with existing node IDs to update.',
                      oneOf: [{ type: 'string' }, { items: { type: 'string' }, type: 'array' }],
                    },
                  },
                  required: ['action', 'litexml'],
                  type: 'object',
                },
                {
                  properties: {
                    action: { const: 'remove', type: 'string' },
                    id: { description: 'ID of the node to remove.', type: 'string' },
                  },
                  required: ['action', 'id'],
                  type: 'object',
                },
              ],
            },
            minItems: 1,
            type: 'array',
          },
        },
        required: ['id', 'operations'],
        type: 'object',
      },
    },
    {
      description:
        "List the user's personal pages. Use this to discover pages or resolve a title to a page ID.",
      name: PersonalPagesApiName.listPages,
      parameters: {
        properties: {},
        required: [],
        type: 'object',
      },
    },
  ],
  identifier: PersonalPagesIdentifier,
  meta: {
    avatar: '📄',
    description: "Manage the user's personal pages (list/create/read/edit)",
    title: 'Personal Pages',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
