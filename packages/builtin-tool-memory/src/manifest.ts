import type { BuiltinToolManifest } from '@lobechat/types';
import {
  ACTIVITY_TYPES,
  CONTEXT_OBJECT_TYPES,
  CONTEXT_STATUS,
  CONTEXT_SUBJECT_TYPES,
  IDENTITY_TYPES,
  MEMORY_TYPES,
  MERGE_STRATEGIES,
  RELATIONSHIPS,
} from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { MemoryApiName } from './types';

export const MemoryIdentifier = 'lobe-user-memory';

export const MemoryManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Retrieve memories based on a search query. Use this to recall previously saved information.',
      name: MemoryApiName.searchUserMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          query: {
            description: 'The search query to find relevant memories',
            type: 'string',
          },
          topK: {
            additionalProperties: false,
            description:
              'Optional. Limits on number of memories to return per layer. If omitted entirely, uses defaults (3 activities, 3 preferences). Set a layer to 0 to exclude it.',
            properties: {
              activities: {
                description: 'Number of activity memories (what happened, when, where). Default: 3',
                minimum: 0,
                type: 'integer',
              },
              contexts: {
                description:
                  'Number of context memories (ongoing situations, projects). Default: 0',
                minimum: 0,
                type: 'integer',
              },
              experiences: {
                description:
                  'Number of experience memories (lessons learned, insights). Default: 0',
                minimum: 0,
                type: 'integer',
              },
              preferences: {
                description:
                  'Number of preference memories (user preferences, directives). Default: 3',
                minimum: 0,
                type: 'integer',
              },
            },
            type: 'object',
          },
        },
        required: ['query'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Create a context memory that captures ongoing situations, projects, or environments. Include actors, resources, statuses, urgency/impact, and a clear description.',
      name: MemoryApiName.addContextMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          details: {
            description: 'Optional detailed information',
            type: 'string',
          },
          memoryCategory: {
            description: 'Memory category',
            type: 'string',
          },
          memoryType: {
            description: 'Memory type',
            enum: MEMORY_TYPES,
            type: 'string',
          },
          summary: {
            description: 'Concise overview of this specific memory',
            type: 'string',
          },
          tags: {
            description: 'User defined tags that summarize the context facets',
            items: { type: 'string' },
            type: 'array',
          },
          title: {
            description: 'Brief descriptive title',
            type: 'string',
          },
          withContext: {
            additionalProperties: false,
            properties: {
              associatedObjects: {
                description:
                  'Array of objects describing involved roles, entities, or resources, [] empty if none',
                items: {
                  additionalProperties: false,
                  properties: {
                    extra: {
                      description:
                        'Additional metadata about the object, should always be a valid JSON string if present',
                      type: ['string', 'null'],
                    },
                    name: {
                      description: 'Name of the associated object',
                      type: 'string',
                    },
                    type: {
                      description: 'Type/category of the associated object',
                      enum: CONTEXT_OBJECT_TYPES,
                      type: 'string',
                    },
                  },
                  required: ['extra', 'name', 'type'],
                  type: 'object',
                },
                type: 'array',
              },
              associatedSubjects: {
                description:
                  'Array of JSON objects describing involved subjects or participants, [] empty if none',
                items: {
                  additionalProperties: false,
                  properties: {
                    extra: {
                      description:
                        'Additional metadata about the subject, should always be a valid JSON string if present',
                      type: ['string', 'null'],
                    },
                    name: {
                      description: 'Name of the associated subject',
                      type: 'string',
                    },
                    type: {
                      description: 'Type/category of the associated subject',
                      enum: CONTEXT_SUBJECT_TYPES,
                      type: 'string',
                    },
                  },
                  required: ['extra', 'name', 'type'],
                  type: 'object',
                },
                type: 'array',
              },
              currentStatus: {
                description:
                  "High level status markers (must be one of 'planned', 'ongoing', 'completed', 'aborted', 'on_hold', 'cancelled')",
                enum: CONTEXT_STATUS,
                type: 'string',
              },
              description: {
                description: 'Rich narrative describing the situation, timeline, or environment',
                type: 'string',
              },
              labels: {
                description: 'Model generated tags that summarize the context themes',
                items: { type: 'string' },
                type: 'array',
              },
              scoreImpact: {
                description: 'Numeric score (0-1 (0% to 100%)) describing importance',
                maximum: 1,
                minimum: 0,
                type: 'number',
              },
              scoreUrgency: {
                description: 'Numeric score (0-1 (0% to 100%)) describing urgency',
                maximum: 1,
                minimum: 0,
                type: 'number',
              },
              title: {
                description: 'Optional synthesized context headline',
                type: 'string',
              },
              type: {
                description:
                  "High level context archetype (e.g., 'project', 'relationship', 'goal')",
                type: 'string',
              },
            },
            required: [
              'associatedObjects',
              'associatedSubjects',
              'currentStatus',
              'description',
              'labels',
              'scoreImpact',
              'scoreUrgency',
              'title',
              'type',
            ],
            type: 'object',
          },
        },
        required: [
          'details',
          'memoryCategory',
          'memoryType',
          'summary',
          'tags',
          'title',
          'withContext',
        ],
        type: 'object',
      },
    },
    {
      description:
        'Record an activity memory capturing what happened, when, where, with whom, and how it felt. Include narrative, feedback, timing, associations, and tags.',
      name: MemoryApiName.addActivityMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          details: {
            description: 'Optional detailed information or longer notes supporting the summary.',
            type: 'string',
          },
          memoryCategory: {
            description: 'Memory category best matching the activity (e.g., work, health).',
            type: 'string',
          },
          memoryType: {
            const: 'activity',
            description: 'Memory type; always activity.',
            type: 'string',
          },
          summary: {
            description: 'Concise overview of this activity.',
            type: 'string',
          },
          tags: {
            description: 'Model generated tags summarizing key facets of the activity.',
            items: { type: 'string' },
            type: 'array',
          },
          title: {
            description: 'Brief descriptive title for the activity.',
            type: 'string',
          },
          withActivity: {
            additionalProperties: false,
            properties: {
              associatedLocations: {
                description: 'Places linked to this activity.',
                items: {
                  additionalProperties: false,
                  properties: {
                    address: { type: ['string', 'null'] },
                    extra: { type: ['string', 'null'] },
                    name: { type: 'string' },
                    tags: { items: { type: 'string' }, type: ['array', 'null'] },
                    type: { type: 'string' },
                  },
                  required: ['name'],
                  type: 'object',
                },
                type: 'array',
              },
              associatedObjects: {
                description: 'Non-living entities or items tied to the activity.',
                items: {
                  additionalProperties: false,
                  properties: {
                    extra: { type: ['string', 'null'] },
                    name: { type: 'string' },
                    type: { type: 'string' },
                  },
                  required: ['name'],
                  type: 'object',
                },
                type: 'array',
              },
              associatedSubjects: {
                description: 'Living beings involved (people, pets, groups).',
                items: {
                  additionalProperties: false,
                  properties: {
                    extra: { type: ['string', 'null'] },
                    name: { type: 'string' },
                    type: { type: 'string' },
                  },
                  required: ['name'],
                  type: 'object',
                },
                type: 'array',
              },
              endsAt: {
                description: 'ISO 8601 end time if provided.',
                format: 'date-time',
                type: ['string', 'null'],
              },
              feedback: {
                description: 'Subjective feelings or evaluation of how the activity went.',
                type: ['string', 'null'],
              },
              metadata: {
                additionalProperties: true,
                description: 'Additional structured metadata to keep raw hints (JSON object).',
                type: ['object', 'null'],
              },
              narrative: {
                description: 'Factual story of what happened; required for recall.',
                type: 'string',
              },
              notes: {
                description: 'Short annotations distinct from narrative.',
                type: ['string', 'null'],
              },
              startsAt: {
                description: 'ISO 8601 start time if provided.',
                format: 'date-time',
                type: ['string', 'null'],
              },
              status: {
                description:
                  'Lifecycle status when mentioned. Use planned/completed/cancelled/ongoing/on_hold/pending. Omit if unclear.',
                enum: ['planned', 'completed', 'cancelled', 'ongoing', 'on_hold', 'pending'],
                type: ['string', 'null'],
              },
              tags: {
                description: 'Optional activity-specific tags or facets.',
                items: { type: 'string' },
                type: ['array', 'null'],
              },
              timezone: {
                description: 'IANA timezone string for the start/end times when provided.',
                type: ['string', 'null'],
              },
              type: {
                description: 'Activity type enum; choose the closest match.',
                enum: ACTIVITY_TYPES,
                type: 'string',
              },
            },
            required: [
              'narrative',
              'type',
              'associatedLocations',
              'associatedObjects',
              'associatedSubjects',
              'startsAt',
              'endsAt',
              'status',
              'tags',
              'timezone',
              'metadata',
              'feedback',
              'notes',
            ],
            type: 'object',
          },
        },
        required: [
          'title',
          'summary',
          'details',
          'memoryType',
          'memoryCategory',
          'tags',
          'withActivity',
        ],
        type: 'object',
      },
    },
    {
      description:
        'Record an experience memory capturing situation, actions, reasoning, outcomes, and confidence. Use for lessons, playbooks, or transferable know-how.',
      name: MemoryApiName.addExperienceMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          details: {
            description: 'Optional detailed information',
            type: 'string',
          },
          memoryCategory: {
            description: 'Memory category',
            type: 'string',
          },
          memoryType: {
            description: 'Memory type',
            enum: MEMORY_TYPES,
            type: 'string',
          },
          summary: {
            description: 'Concise overview of this specific memory',
            type: 'string',
          },
          tags: {
            description: 'Model generated tags that summarize the experience facets',
            items: { type: 'string' },
            type: 'array',
          },
          title: {
            description: 'Brief descriptive title',
            type: 'string',
          },
          withExperience: {
            additionalProperties: false,
            properties: {
              action: {
                description: 'Narrative describing actions taken or behaviors exhibited',
                type: 'string',
              },
              keyLearning: {
                description: 'Narrative describing key insights or lessons learned',
                type: 'string',
              },
              knowledgeValueScore: {
                description:
                  'Numeric score (0-1) describing how reusable and shareable this experience is',
                maximum: 1,
                minimum: 0,
                type: 'number',
              },
              labels: {
                description: 'Model generated tags that summarize the experience facets',
                items: { type: 'string' },
                type: 'array',
              },
              possibleOutcome: {
                description: 'Narrative describing potential outcomes or learnings',
                type: 'string',
              },
              problemSolvingScore: {
                description:
                  'Numeric score (0-1) describing how effectively the problem was solved',
                maximum: 1,
                minimum: 0,
                type: 'number',
              },
              reasoning: {
                description: 'Narrative describing the thought process or motivations',
                type: 'string',
              },
              scoreConfidence: {
                description:
                  'Numeric score (0-1 (0% to 100%)) describing confidence in the experience details',
                maximum: 1,
                minimum: 0,
                type: 'number',
              },
              situation: {
                description: 'Narrative describing the situation or event',
                type: 'string',
              },
              type: {
                description: 'Type of experience being recorded',
                type: 'string',
              },
            },
            required: [
              'situation',
              'reasoning',
              'action',
              'possibleOutcome',
              'keyLearning',
              'type',
              'labels',
              'problemSolvingScore',
              'scoreConfidence',
              'knowledgeValueScore',
            ],
            type: 'object',
          },
        },
        required: [
          'details',
          'memoryCategory',
          'memoryType',
          'summary',
          'tags',
          'title',
          'withExperience',
        ],
        type: 'object',
      },
    },
    {
      description:
        'Add an identity memory describing enduring facts about a person, their role, relationship, and supporting evidence. Use to track self/others identities.',
      name: MemoryApiName.addIdentityMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          details: {
            description: 'Optional detailed information',
            type: ['string', 'null'],
          },
          memoryCategory: {
            description: 'Memory category',
            type: 'string',
          },
          memoryType: {
            description: 'Memory type',
            enum: MEMORY_TYPES,
            type: 'string',
          },
          summary: {
            description: 'Concise overview of this specific memory',
            type: 'string',
          },
          tags: {
            description: 'Model generated tags that summarize the identity facets',
            items: { type: 'string' },
            type: 'array',
          },
          title: {
            description:
              'Honorific-style, concise descriptor (strength + domain/milestone), avoid bare job titles; e.g., "Trusted open-source maintainer", "Specializes in low-latency infra", "Former Aliyun engineer", "Cares for rescue cats"',
            type: 'string',
          },
          withIdentity: {
            additionalProperties: false,
            properties: {
              description: { type: 'string' },
              episodicDate: { type: ['string', 'null'] },
              extractedLabels: {
                items: { type: 'string' },
                type: 'array',
              },
              relationship: {
                enum: RELATIONSHIPS,
                type: 'string',
              },
              role: {
                description:
                  'Role explicitly mentioned for this identity entry (e.g., "platform engineer", "caregiver"); keep neutral and only use when evidence exists',
                type: 'string',
              },
              scoreConfidence: { type: 'number' },
              sourceEvidence: { type: ['string', 'null'] },
              type: {
                enum: IDENTITY_TYPES,
                type: 'string',
              },
            },
            required: [
              'description',
              'episodicDate',
              'extractedLabels',
              'relationship',
              'role',
              'scoreConfidence',
              'sourceEvidence',
              'type',
            ],
            type: 'object',
          },
        },
        required: [
          'details',
          'memoryCategory',
          'memoryType',
          'summary',
          'tags',
          'title',
          'withIdentity',
        ],
        type: 'object',
      },
    },
    {
      description:
        'Create a preference memory that encodes durable directives or choices the assistant should follow. Include conclusionDirectives, scopes, and context.',
      name: MemoryApiName.addPreferenceMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          details: {
            description: 'Optional detailed information',
            type: 'string',
          },
          memoryCategory: {
            description: 'Memory category',
            type: 'string',
          },
          memoryType: {
            description: 'Memory type',
            enum: MEMORY_TYPES,
            type: 'string',
          },
          summary: {
            description: 'Concise overview of this specific memory',
            type: 'string',
          },
          tags: {
            description: 'Model generated tags that summarize the preference facets',
            items: { type: 'string' },
            type: 'array',
          },
          title: {
            description: 'Brief descriptive title',
            type: 'string',
          },
          withPreference: {
            additionalProperties: false,
            properties: {
              appContext: {
                additionalProperties: false,
                description: 'Application/surface specific preference, if any',
                properties: {
                  app: {
                    description: 'App or product name this applies to',
                    type: ['string', 'null'],
                  },
                  feature: { type: ['string', 'null'] },
                  route: { type: ['string', 'null'] },
                  surface: {
                    description: 'e.g., chat, emails, code review, notes',
                    type: ['string', 'null'],
                  },
                },
                required: ['app', 'feature', 'route', 'surface'],
                type: ['object', 'null'],
              },
              conclusionDirectives: {
                description:
                  "Direct, self-contained instruction to the assistant from the user's perspective (what to do, not how to implement)",
                type: 'string',
              },
              extractedLabels: {
                description: 'Model generated tags that summarize the preference facets',
                items: { type: 'string' },
                type: 'array',
              },
              extractedScopes: {
                description:
                  'Array of JSON strings describing preference facets and applicable scopes',
                items: { type: 'string' },
                type: 'array',
              },
              originContext: {
                additionalProperties: false,
                description: 'Context of how/why this preference was expressed',
                properties: {
                  actor: {
                    description: "Who stated the preference; use 'User' for the user",
                    type: 'string',
                  },
                  applicableWhen: {
                    description: 'Conditions where this preference applies',
                    type: ['string', 'null'],
                  },
                  notApplicableWhen: {
                    description: 'Conditions where it does not apply',
                    type: ['string', 'null'],
                  },
                  scenario: {
                    description: 'Applicable scenario or use case',
                    type: ['string', 'null'],
                  },
                  trigger: {
                    description: 'What prompted this preference',
                    type: ['string', 'null'],
                  },
                },
                required: ['actor', 'applicableWhen', 'notApplicableWhen', 'scenario', 'trigger'],
                type: ['object', 'null'],
              },
              scorePriority: {
                description:
                  'Numeric prioritization weight (0-1 (0% to 100%)) where higher means more critical to respect',
                maximum: 1,
                minimum: 0,
                type: 'number',
              },
              suggestions: {
                description: 'Follow-up actions or assistant guidance derived from the preference',
                items: { type: 'string' },
                type: 'array',
              },
              type: {
                description:
                  "High level preference classification (e.g., 'lifestyle', 'communication')",
                type: 'string',
              },
            },
            required: [
              'appContext',
              'conclusionDirectives',
              'extractedLabels',
              'extractedScopes',
              'originContext',
              'scorePriority',
              'suggestions',
              'type',
            ],
            type: 'object',
          },
        },
        required: [
          'title',
          'summary',
          'tags',
          'details',
          'memoryCategory',
          'memoryType',
          'withPreference',
        ],
        type: 'object',
      },
    },
    {
      description:
        'Update an existing identity memory with refined details, relationships, roles, or tags. Use mergeStrategy to control replacement vs merge.',
      name: MemoryApiName.updateIdentityMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          mergeStrategy: {
            enum: MERGE_STRATEGIES,
            type: 'string',
          },
          set: {
            additionalProperties: false,
            properties: {
              details: {
                description: 'Optional detailed information, use null for omitting the field',
                type: ['string', 'null'],
              },
              memoryCategory: {
                description: 'Memory category, use null for omitting the field',
                type: ['string', 'null'],
              },
              memoryType: {
                description: 'Memory type, use null for omitting the field',
                enum: [...MEMORY_TYPES, null],
                type: ['string', 'null'],
              },
              summary: {
                description:
                  'Concise overview of this specific memory, use null for omitting the field',
                type: ['string', 'null'],
              },
              tags: {
                description:
                  'Model generated tags that summarize the identity facets, use null for omitting the field',
                items: { type: 'string' },
                type: ['array', 'null'],
              },
              title: {
                description:
                  'Honorific-style, concise descriptor (strength + domain/milestone), avoid bare job titles; e.g., "Trusted open-source maintainer", "Specializes in low-latency infra", "Former Aliyun engineer", "Cares for rescue cats"; use null for omitting the field',
                type: ['string', 'null'],
              },
              withIdentity: {
                additionalProperties: false,
                properties: {
                  description: { type: ['string', 'null'] },
                  episodicDate: { type: ['string', 'null'] },
                  extractedLabels: {
                    items: { type: 'string' },
                    type: ['array', 'null'],
                  },
                  relationship: {
                    description: `Possible values: ${RELATIONSHIPS.join(' | ')}`,
                    type: ['string', 'null'],
                  },
                  role: {
                    description:
                      'Role explicitly mentioned for this identity entry (e.g., "platform engineer", "caregiver"); keep existing when not updated; use null for omitting the field',
                    type: ['string', 'null'],
                  },
                  scoreConfidence: { type: ['number', 'null'] },
                  sourceEvidence: { type: ['string', 'null'] },
                  type: {
                    description: `Possible values: ${IDENTITY_TYPES.join(' | ')}`,
                    type: ['string', 'null'],
                  },
                },
                required: ['description', 'extractedLabels', 'role'],
                type: 'object',
              },
            },
            required: ['withIdentity'],
            type: 'object',
          },
        },
        required: ['id', 'mergeStrategy', 'set'],
        type: 'object',
      },
    },
    {
      description:
        'Remove an identity memory when it is incorrect, obsolete, or duplicated. Always provide a concise reason.',
      name: MemoryApiName.removeIdentityMemory,
      parameters: {
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['id', 'reason'],
        type: 'object',
      },
    },
  ],
  identifier: 'lobe-user-memory',
  meta: {
    avatar: '🧠',
    description: 'Remember user preferences, activities, and experiences across conversations',
    readme:
      'Build a personalized knowledge base about you. Remember preferences, track activities and experiences, store identity information, and recall relevant context in future conversations.',
    title: 'Memory',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
