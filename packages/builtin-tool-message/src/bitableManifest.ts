import type { BuiltinToolManifest } from '@lobechat/types';

import { MessageApiName } from './types';

/** Bitable exists only on Feishu and its international edition Lark. */
const platformEnum = ['feishu', 'lark'];

/**
 * Feishu / Lark Bitable (多维表格) APIs of the `lobe-message` tool. Every other
 * platform trims them via `unsupportedMessageApis`.
 */
export const bitableApis: BuiltinToolManifest['api'] = [
  {
    description:
      "Create a Feishu/Lark Bitable (多维表格) with typed columns, optionally seed it with rows, and share it with people — all in one call, on the bot's own app credentials (never ask the user for an App Secret or token). The bot app owns the new Bitable, so always add the requester (their `<speaker>` id) as a collaborator. Returns the Bitable URL to post in the chat.",
    name: MessageApiName.createBitable,
    parameters: {
      additionalProperties: false,
      properties: {
        collaborators: {
          description:
            'People to share the Bitable with. Without this nobody but the bot app can open it — always include the requester.',
          items: {
            additionalProperties: false,
            properties: {
              openId: {
                description:
                  'Feishu/Lark open_id (`ou_…`) — the `id` on a `<speaker>` tag or mention.',
                type: 'string',
              },
              perm: {
                description:
                  'Access level. Defaults to `full_access` (can manage and share); use `edit` or `view` when asked.',
                enum: ['view', 'edit', 'full_access'],
                type: 'string',
              },
            },
            required: ['openId'],
            type: 'object',
          },
          type: 'array',
        },
        fields: {
          description:
            'Columns in display order; the first one is the primary column and must be `text`, `number`, `date` or `url` (use a text column such as the task title). Max 100.',
          items: {
            additionalProperties: false,
            properties: {
              name: { description: 'Column name, unique within the table.', type: 'string' },
              options: {
                description:
                  'Choices for `singleSelect` / `multiSelect` (e.g. ["待开始", "进行中", "已完成"]).',
                items: { type: 'string' },
                type: 'array',
              },
              type: {
                description:
                  'Column type. `person` cells hold open_ids, `date` cells a date string ("2026-11-20") or millisecond timestamp (a value of 10 digits or fewer is read as Unix seconds), `url` cells a link.',
                enum: [
                  'text',
                  'number',
                  'singleSelect',
                  'multiSelect',
                  'date',
                  'checkbox',
                  'person',
                  'url',
                ],
                type: 'string',
              },
            },
            required: ['name', 'type'],
            type: 'object',
          },
          minItems: 1,
          type: 'array',
        },
        folderToken: {
          description:
            "Drive folder token to create the Bitable in. Omit to use the bot app's own space.",
          type: 'string',
        },
        name: { description: 'Bitable (file) name.', type: 'string' },
        platform: {
          description: 'Target messaging platform (feishu or lark).',
          enum: platformEnum,
          type: 'string',
        },
        records: {
          description:
            'Initial rows, each an object keyed by column name, e.g. {"任务": "整理需求", "负责人": ["ou_xxx"], "截止日期": "2026-11-20", "状态": "进行中"}.',
          items: { type: 'object' },
          type: 'array',
        },
        tableName: {
          description: 'Name of the table inside the Bitable. Defaults to `name`.',
          type: 'string',
        },
      },
      required: ['platform', 'name', 'fields'],
      type: 'object',
    },
  },
  {
    description:
      'Append rows to an existing Feishu/Lark Bitable (多维表格), e.g. one created with createBitable. Values are keyed by column name and converted to each column type (dates, people, links, selects).',
    name: MessageApiName.addBitableRecords,
    parameters: {
      additionalProperties: false,
      properties: {
        appToken: {
          description: 'Bitable app token (the `<token>` in `/base/<token>`). Prefer `url`.',
          type: 'string',
        },
        platform: {
          description: 'Target messaging platform (feishu or lark).',
          enum: platformEnum,
          type: 'string',
        },
        records: {
          description: 'Rows to add, each an object keyed by column name.',
          items: { type: 'object' },
          minItems: 1,
          type: 'array',
        },
        tableId: {
          description:
            "Table id (`tbl…`). Defaults to the URL's `?table=` and then to the first table.",
          type: 'string',
        },
        url: {
          description: 'Bitable URL, e.g. https://<tenant>.feishu.cn/base/<token>?table=<tableId>.',
          type: 'string',
        },
      },
      required: ['platform', 'records'],
      type: 'object',
    },
  },
];
