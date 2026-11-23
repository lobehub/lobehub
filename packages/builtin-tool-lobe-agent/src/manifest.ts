import type { BuiltinToolManifest } from '@lobechat/types';

import { isDesktop } from './const';
import { MAX_MEDIA_URLS } from './media';
import { systemPrompt } from './systemRole';
import {
  LobeAgentApiName,
  LobeAgentIdentifier,
  VENT_CATEGORIES,
  VENT_EVIDENCE_REF_TYPES,
  VENT_SEVERITIES,
} from './types';

export const LobeAgentManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Analyze audio, images, or videos via refs or direct URLs and answer a question about them. Prefer the active model's native multimodal capability when it can inspect the media directly; use this tool only as a fallback when native capability is unavailable or media appears only as remote URLs. Provide either refs or urls (at least one required). Prefer refs when stable refs are available in <files_info> (e.g. msg_xxx.audio_1, msg_xxx.image_1, msg_xxx.video_1), and use urls only for direct media URLs not available as refs. For local filesystem media, never pass OS paths or file:// URLs or copy base64 text — upload with a local file-reading tool first and pass its stable ref. After this tool returns, answer the user directly with the result.",
      name: LobeAgentApiName.analyzeMedia,
      parameters: {
        additionalProperties: false,
        properties: {
          question: {
            description: 'Question or task to answer about the media.',
            type: 'string',
          },
          refs: {
            description:
              'Stable media refs from <files_info> (including uploads from local file-reading tools), e.g. ["msg_xxx.image_1"].',
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
          urls: {
            description: `Direct provider-readable HTTP(S) or data URLs (at most ${MAX_MEDIA_URLS} per call). Local filesystem paths and file:// URLs are unsupported — use a local file-reading tool first and pass its stable ref via refs.`,
            items: {
              type: 'string',
            },
            maxItems: MAX_MEDIA_URLS,
            minItems: 1,
            type: 'array',
          },
        },
        required: ['question'],
        type: 'object',
      },
    },

    // ==================== Planning ====================
    {
      description: 'Create a high-level strategic plan document (goal, summary, and context).',
      name: LobeAgentApiName.createPlan,
      humanIntervention: 'required',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          goal: {
            description: 'Main objective (used as document title).',
            type: 'string',
          },
          description: {
            description: 'Brief 1-2 sentence summary.',
            type: 'string',
          },
          context: {
            description: 'Constraints, background, and strategic context.',
            type: 'string',
          },
        },
        required: ['goal', 'description', 'context'],
        type: 'object',
      },
    },
    {
      description: 'Update an existing plan document when the overarching goal changes.',
      name: LobeAgentApiName.updatePlan,
      parameters: {
        properties: {
          planId: {
            description:
              'Plan document ID (e.g. "docs_xxx") returned by createPlan. Do NOT use the goal text as planId.',
            type: 'string',
          },
          goal: {
            description: 'Updated goal (document title).',
            type: 'string',
          },
          description: {
            description: 'Updated brief summary.',
            type: 'string',
          },
          context: {
            description: 'Updated context.',
            type: 'string',
          },
        },
        required: ['planId'],
        type: 'object',
      },
    },

    // ==================== Quick Todo ====================
    {
      description: 'Create new todo items from a list of strings.',
      name: LobeAgentApiName.createTodos,
      humanIntervention: 'required',
      parameters: {
        properties: {
          adds: {
            description: 'Todo item texts to create.',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['adds'],
        type: 'object',
      },
    },
    {
      description:
        'Batch update todos: add (text), update (index + newText/status), or remove/complete/processing (index only).',
      name: LobeAgentApiName.updateTodos,
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          operations: {
            description: 'Operations to apply in order.',
            items: {
              properties: {
                type: {
                  enum: ['add', 'update', 'remove', 'complete', 'processing'],
                  type: 'string',
                },
                text: {
                  description: 'For "add": item text.',
                  type: 'string',
                },
                index: {
                  description: '0-based index (for update/remove/complete/processing).',
                  type: 'number',
                },
                newText: {
                  description: 'For "update": replacement text.',
                  type: 'string',
                },
                status: {
                  description: 'For "update": new status.',
                  enum: ['todo', 'processing', 'completed'],
                  type: 'string',
                },
              },
              required: ['type'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['operations'],
        type: 'object',
      },
    },
    {
      description: 'Clear completed or all todo items.',
      name: LobeAgentApiName.clearTodos,
      humanIntervention: 'required',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          mode: {
            enum: ['completed', 'all'],
            type: 'string',
          },
        },
        required: ['mode'],
        type: 'object',
      },
    },

    // ==================== Ask User Question ====================
    {
      description: 'Ask the user one or more clarifying questions with multiple-choice options.',
      humanIntervention: 'always',
      name: LobeAgentApiName.askUserQuestion,
      renderDisplayControl: 'collapsed',
      parameters: {
        properties: {
          questions: {
            items: {
              properties: {
                header: { type: 'string' },
                multiSelect: { type: 'boolean' },
                options: {
                  items: {
                    properties: {
                      description: { type: 'string' },
                      label: { type: 'string' },
                    },
                    required: ['label', 'description'],
                    type: 'object',
                  },
                  maxItems: 4,
                  minItems: 2,
                  type: 'array',
                },
                question: { type: 'string' },
              },
              required: ['header', 'question', 'options'],
              type: 'object',
            },
            maxItems: 4,
            minItems: 1,
            type: 'array',
          },
        },
        required: ['questions'],
        type: 'object',
      },
    },

    // ==================== Sub-Agent ====================
    {
      description:
        'Dispatch an isolated sub-agent for multi-step work, or pass `subAgentId` to continue or steer an existing sub-agent.',
      name: LobeAgentApiName.callSubAgent,
      parameters: {
        properties: {
          description: {
            description: 'Short UI label for the task.',
            type: 'string',
          },
          instruction: {
            description: 'Detailed prompt for the sub-agent.',
            type: 'string',
          },
          inheritMessages: {
            description: 'Inherit parent conversation history (default false).',
            type: 'boolean',
          },
          subAgentId: {
            description:
              'ID from an earlier `<sub_agent id="..." />` tag to resume a stopped sub-agent or steer a running one. Omit to start a new sub-agent; never invent an ID.',
            type: 'string',
          },
          runInBackground: {
            description:
              'Return immediately with the sub-agent ID and deliver `<sub_agent_result>` later (default false: wait in this turn). Never poll.',
            type: 'boolean',
          },
          ...(isDesktop && {
            runInClient: {
              description:
                'Run on the desktop client (must be true for local-system file/shell access; default false).',
              type: 'boolean',
            },
          }),
          timeout: {
            description: 'Timeout in ms (default 30 min).',
            type: 'number',
          },
        },
        required: ['description', 'instruction'],
        type: 'object',
      },
    },
    {
      description:
        'Cancel a running sub-agent whose result is no longer needed (to steer one instead, use `callSubAgent` with its `subAgentId`).',
      name: LobeAgentApiName.cancelSubAgent,
      parameters: {
        additionalProperties: false,
        properties: {
          subAgentId: {
            description: 'ID from `<sub_agent id="..." />`. Never invent an ID.',
            type: 'string',
          },
          reason: {
            description: 'Optional short reason.',
            type: 'string',
          },
        },
        required: ['subAgentId'],
        type: 'object',
      },
    },

    // ==================== Vent ====================
    {
      description:
        'Privately report genuine platform friction to platform builders (not user-facing; fixes nothing). Use sparingly: at most one vent per run, only for the single worst blocker. It never stops a tool loop or ends your turn — to stop, reply to the user; repeated or empty vents are rejected.',
      name: LobeAgentApiName.vent,
      parameters: {
        additionalProperties: false,
        properties: {
          category: {
            description:
              'missing_tool (no tool exists), schema_mismatch (params disagree with docs/behavior), doc_conflict (wrong/contradictory docs), platform_bug (anomalous surface error), env_limitation (sandbox/network/timeout/resource limit), or other.',
            enum: [...VENT_CATEGORIES],
            type: 'string',
          },
          severity: {
            description: 'high = blocked, medium = costly workaround, low = minor friction.',
            enum: [...VENT_SEVERITIES],
            type: 'string',
          },
          summary: {
            description: 'One short sentence naming the specific friction/surface.',
            type: 'string',
          },
          details: {
            description: 'What you tried, expected, observed, and why it blocked you.',
            type: 'string',
          },
          attempts: {
            description: 'How many times you hit this blocker.',
            minimum: 1,
            type: 'integer',
          },
          toolName: {
            description: 'Exact tool/API/surface involved, if applicable.',
            type: 'string',
          },
          evidenceRefs: {
            description: 'Optional stable refs (tool_call, message, operation, topic, task).',
            items: {
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                summary: { type: 'string' },
                type: {
                  enum: [...VENT_EVIDENCE_REF_TYPES],
                  type: 'string',
                },
              },
              required: ['id', 'type'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['category', 'severity', 'summary', 'details'],
        type: 'object',
      },
    },
  ],
  identifier: LobeAgentIdentifier,
  meta: {
    avatar: '🤖',
    description:
      'Create and update conversation plans and todos, ask the user a structured question, analyze media, report a platform blocker, or delegate work to a sub-agent when available.',
    readme: 'Lobe Agent provides built-in assistant capabilities that can be expanded over time.',
    title: 'Lobe Agent',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
