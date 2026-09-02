import type { BuiltinToolManifest } from '@lobechat/types';

import { isDesktop } from './const';
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
        "Analyze audio, images, or videos selected by media file refs or direct media URLs and answer a question about them. Prefer the active model's native multimodal capability when it can inspect the media directly; use this tool only as a fallback when the active model lacks the required audio, image, or video capability. Provide either refs or urls; at least one is required. Prefer refs when stable refs are available in <files_info>, such as msg_xxx.audio_1, msg_xxx.image_1, or msg_xxx.video_1, and use urls only for direct media URLs that are not available as message refs. For media stored on a local filesystem, never pass an OS path or file:// URL through urls and never convert or copy the media as base64 text. If this fallback is needed, first use an available local file-reading tool to upload the media, then pass its stable ref through refs. After this tool returns, answer the user directly with the result.",
      name: LobeAgentApiName.analyzeMedia,
      parameters: {
        additionalProperties: false,
        properties: {
          question: {
            description: 'The question or task to answer about the selected media.',
            type: 'string',
          },
          refs: {
            description:
              'Stable media file ref strings from <files_info>, including refs created for media uploaded by local file-reading tools, such as ["msg_xxx.audio_1"], ["msg_xxx.image_1"], or ["msg_xxx.video_1"].',
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
          urls: {
            description:
              'Direct provider-readable HTTP(S) or data URLs to analyze when no stable media ref exists. Local filesystem paths and file:// URLs are unsupported; use an available local file-reading tool first, then pass its stable ref through refs.',
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

    // ==================== Planning ====================
    {
      description:
        'Create a high-level plan document. Plans define the strategic direction (the "what" and "why"), while todos handle the actionable steps.',
      name: LobeAgentApiName.createPlan,
      humanIntervention: 'required',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          goal: {
            description: 'The main goal or objective to achieve (used as document title).',
            type: 'string',
          },
          description: {
            description: 'A brief summary of the plan (1-2 sentences).',
            type: 'string',
          },
          context: {
            description:
              'Detailed context, constraints, background information, or strategic considerations relevant to the goal.',
            type: 'string',
          },
        },
        required: ['goal', 'description', 'context'],
        type: 'object',
      },
    },
    {
      description:
        'Update an existing plan document. Only use this when the goal fundamentally changes. Plans should remain stable once created - do not update plans just because details change.',
      name: LobeAgentApiName.updatePlan,
      parameters: {
        properties: {
          planId: {
            description:
              'The document ID of the plan to update (e.g., "docs_xxx"). This ID is returned in the createPlan response. Do NOT use the goal text as planId.',
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
            description: 'Updated detailed context.',
            type: 'string',
          },
        },
        required: ['planId'],
        type: 'object',
      },
    },

    // ==================== Quick Todo ====================
    {
      description: 'Create new todo items. Pass an array of text strings.',
      name: LobeAgentApiName.createTodos,
      humanIntervention: 'required',
      parameters: {
        properties: {
          adds: {
            description: 'Array of todo item texts to create.',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['adds'],
        type: 'object',
      },
    },
    {
      description: `Update todo items with batch operations. Each operation type requires specific fields:
- "add": requires "text" (the todo text to add)
- "update": requires "index", optional "newText" and/or "status"
- "remove": requires "index" only
- "complete": requires "index" only (marks item as completed)
- "processing": requires "index" only (marks item as in progress)`,
      name: LobeAgentApiName.updateTodos,
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          operations: {
            description:
              'Array of update operations. IMPORTANT: For "complete", "processing" and "remove" operations, only pass "type" and "index" - no other fields needed.',
            items: {
              properties: {
                type: {
                  description:
                    'Operation type. "add" needs text, "update" needs index + optional newText/status, "remove", "complete" and "processing" need index only.',
                  enum: ['add', 'update', 'remove', 'complete', 'processing'],
                  type: 'string',
                },
                text: {
                  description: 'Required for "add" only: the text to add.',
                  type: 'string',
                },
                index: {
                  description:
                    'Required for "update", "remove", "complete", "processing": the item index (0-based).',
                  type: 'number',
                },
                newText: {
                  description: 'Optional for "update" only: the new text.',
                  type: 'string',
                },
                status: {
                  description:
                    'Optional for "update" only: set status (todo, processing, completed).',
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
      description: 'Clear todo items. Can clear only completed items or all items.',
      name: LobeAgentApiName.clearTodos,
      humanIntervention: 'required',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          mode: {
            description: '"completed" clears only done items, "all" clears the entire list.',
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
        'Privately report friction in your own working conditions to the platform builders when you are genuinely blocked — a missing tool, a parameter/schema mismatch, conflicting or wrong docs, anomalous platform behavior, or an environment limit causing repeated failure. Not user-facing; it only records the report and does not fix anything. Use sparingly: at most one vent per task, only for the single worst blocker.',
      name: LobeAgentApiName.vent,
      parameters: {
        additionalProperties: false,
        properties: {
          category: {
            description:
              'Friction category: missing_tool, schema_mismatch, doc_conflict, platform_bug, env_limitation, or other.',
            enum: [...VENT_CATEGORIES],
            type: 'string',
          },
          severity: {
            description:
              'How badly it blocked the task: high = could not complete, medium = forced a costly workaround, low = friction but recovered.',
            enum: [...VENT_SEVERITIES],
            type: 'string',
          },
          summary: {
            description:
              'One short sentence naming the specific friction. Name the tool/surface if one is at fault.',
            type: 'string',
          },
          details: {
            description:
              'What you tried, what you expected, what actually happened, and why it blocked you. Specific enough for an engineer to reproduce or fix.',
            type: 'string',
          },
          attempts: {
            description: 'How many times you hit this wall before venting, when countable.',
            minimum: 1,
            type: 'integer',
          },
          toolName: {
            description:
              'Exact tool/API/surface involved, when one specific component is at fault.',
            type: 'string',
          },
          evidenceRefs: {
            description:
              'Optional stable references that ground the report. Prefer tool_call, message, operation, topic, or task refs.',
            items: {
              additionalProperties: false,
              properties: {
                id: { description: 'Stable evidence identifier.', type: 'string' },
                summary: {
                  description: 'Optional short note explaining why this evidence matters.',
                  type: 'string',
                },
                type: {
                  description: 'Evidence object type.',
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
      'Run built-in Lobe Agent capabilities: plan + todo management, sub-agent dispatch, and multimodal media analysis.',
    readme: 'Lobe Agent provides built-in assistant capabilities that can be expanded over time.',
    title: 'Lobe Agent',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
