import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import type { LayersEnum } from '@lobechat/types';
import { ActivityTypeEnum, TypesEnum } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';
import { z } from 'zod';

import { MemoryTypeSchema } from './common';

const ActivityAssociatedLocationSchema = z.object({
  address: z.string().optional().nullable(),
  extra: z.string().nullable().optional(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional().nullable(),
  type: z.string().optional(),
});

const ActivityAssociationSchema = z.object({
  extra: z.string().nullable().optional(),
  name: z.string(),
  type: z.string().optional(),
});

export const WithActivitySchema = z.object({
  associatedLocations: z.array(ActivityAssociatedLocationSchema).optional().nullable(),
  associatedObjects: z.array(ActivityAssociationSchema).optional().nullable(),
  associatedSubjects: z.array(ActivityAssociationSchema).optional().nullable(),
  endsAt: z.string().optional().nullable(),
  feedback: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
  narrative: z.string(),
  notes: z.string().optional().nullable(),
  startsAt: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  timezone: z.string().optional().nullable(),
  type: z.union([z.nativeEnum(ActivityTypeEnum), z.string()]).optional(),
});

export const ActivityMemoryItemSchema = z.object({
  details: z.string(),
  memoryCategory: z.string(),
  memoryType: MemoryTypeSchema,
  summary: z.string(),
  tags: z.array(z.string()),
  title: z.string(),
  withActivity: WithActivitySchema,
});

export const ActivityMemoriesSchema = z.object({
  memories: z.array(ActivityMemoryItemSchema),
});

export type WithActivity = z.infer<typeof WithActivitySchema>;
export type ActivityMemoryItem = z.infer<typeof ActivityMemoryItemSchema> & {
  memoryLayer?: LayersEnum.Activity;
  memoryType: TypesEnum.Activity;
};
export type ActivityMemory = z.infer<typeof ActivityMemoriesSchema>;

export const ActivityMemorySchema: GenerateObjectSchema = {
  description:
    'Extract episodic activities with clear timelines, participants, objects, subjects, locations, and feelings. Temporal and associated fields are optional—omit when missing rather than guessing.',
  name: 'activity_extraction',
  schema: {
    additionalProperties: false,
    properties: {
      memories: {
        description:
          'Array of extracted activity memories. Use an empty array when no activity should be captured.',
        items: {
          additionalProperties: false,
          description:
            'Self-contained activity memory describing what happened, when, where, with whom, and how it felt.',
          examples: [
            {
              details:
                'Talked through renewal scope, confirmed timeline flexibility, and captured follow-ups.',
              memoryCategory: 'work',
              memoryType: 'activity',
              summary: 'Client Q2 renewal meeting with Alice (ACME)',
              tags: ['meeting', 'client', 'renewal'],
              title: 'ACME Q2 renewal meeting',
              withActivity: {
                associatedLocations: [
                  {
                    address: '123 Main St, New York, NY',
                    name: 'ACME HQ',
                  },
                ],
                associatedSubjects: [{ name: 'Alice Smith', type: 'person' }],
                endsAt: '2024-05-03T15:00:00-04:00',
                feedback: 'Positive momentum; Alice felt heard and open to renewal.',
                narrative:
                  'Alice and User reviewed Q2 renewal scope, aligned on reduced deliverables, and agreed to share revised pricing next week.',
                notes: 'Agenda: renewal scope, pricing, next steps.',
                startsAt: '2024-05-03T14:00:00-04:00',
                status: 'completed',
                timezone: 'America/New_York',
                type: 'meeting',
              },
            },
            {
              details: 'Routine check-up; discussed migraines and sleep habits.',
              memoryCategory: 'health',
              memoryType: 'activity',
              summary: 'Doctor appointment with Dr. Kim about migraines',
              tags: ['appointment', 'health'],
              title: 'Neurology follow-up',
              withActivity: {
                associatedLocations: [
                  {
                    name: 'City Neurology Clinic',
                  },
                ],
                associatedSubjects: [{ name: 'Dr. Kim', type: 'person' }],
                feedback: 'Felt reassured; plan seems manageable.',
                narrative:
                  'User saw Dr. Kim to review migraine frequency; decided to track sleep, hydration, and start a low-dose preventive.',
                notes: 'Discussed triggers, hydration, and medication side effects.',
                status: 'completed',
                type: 'appointment',
              },
            },
          ],
          properties: {
            details: {
              description:
                'Optional detailed information or longer notes supporting the summary and narrative.',
              type: 'string',
            },
            memoryCategory: {
              description:
                'Memory category best matching the activity (e.g., work, health, travel, relationships).',
              type: 'string',
            },
            memoryType: {
              const: TypesEnum.Activity,
              description: 'Memory type; always activity.',
              type: 'string',
            },
            summary: {
              description: 'Concise overview of this activity.',
              type: 'string',
            },
            tags: {
              description: 'Model-generated tags summarizing key facets of the activity.',
              items: { type: 'string' },
              type: 'array',
            },
            title: {
              description:
                'Brief descriptive title for the activity, e.g., "Dinner with friends at Marina".',
              type: 'string',
            },
            withActivity: {
              additionalProperties: false,
              description:
                'Structured activity fields. Temporal and association values are optional—include only when the user mentioned them.',
              properties: {
                associatedLocations: {
                  description:
                    'Places linked to this activity. Capture any mentioned venue, address, or setting.',
                  items: {
                    additionalProperties: false,
                    properties: {
                      address: {
                        description: 'Free-form address or directions if provided.',
                        type: ['string', 'null'],
                      },
                      extra: {
                        description: 'Optional key-value metadata related to the location.',
                        type: ['string', 'null'],
                      },
                      name: {
                        description: 'Place name or venue label.',
                        type: 'string',
                      },
                      tags: {
                        description: 'Place-related tags (e.g., indoor, outdoor, virtual).',
                        items: { type: 'string' },
                        type: ['array', 'null'],
                      },
                      type: {
                        description:
                          'Place type or category (office, clinic, restaurant, virtual).',
                        type: 'string',
                      },
                    },
                    required: ['type', 'name', 'address', 'tags', 'extra'],
                    type: 'object',
                  },
                  type: 'array',
                },
                associatedObjects: {
                  description:
                    'Non-living entities or items tied to the activity (e.g., transportation for trips, devices, tools).',
                  items: {
                    additionalProperties: false,
                    properties: {
                      extra: {
                        description: 'Optional key-value metadata related to the object.',
                        type: ['string', 'null'],
                      },
                      name: {
                        description:
                          'Name or label of the object (e.g., “MacBook”, “flight UA123”).',
                        type: 'string',
                      },
                      type: {
                        description: 'Object category (e.g., transportation, device, document).',
                        enum: ['application', 'item', 'knowledge', 'other', 'person', 'place'],
                        type: 'string',
                      },
                    },
                    required: ['type', 'name', 'extra'],
                    type: 'object',
                  },
                  type: 'array',
                },
                associatedSubjects: {
                  description:
                    'Living beings involved (people, pets, groups). Use when the subject lacks a known identity ID.',
                  items: {
                    additionalProperties: false,
                    properties: {
                      extra: {
                        description: 'Optional key-value metadata related to the subject.',
                        type: ['string', 'null'],
                      },
                      name: {
                        description: 'Name or short label of the subject.',
                        type: 'string',
                      },
                      type: {
                        description: 'Subject category (e.g., person, pet, group).',
                        enum: ['person', 'pet', 'group', 'other'],
                        type: 'string',
                      },
                    },
                    required: ['type', 'name', 'extra'],
                    type: 'object',
                  },
                  type: 'array',
                },
                endsAt: {
                  description:
                    'ISO 8601 end time for the activity when specified. Omit if not explicitly provided.',
                  format: 'date-time',
                  type: ['string', 'null'],
                },
                feedback: {
                  description:
                    'Subjective feelings or evaluation of how the activity went (mood, satisfaction, effort).',
                  type: ['string', 'null'],
                },
                metadata: {
                  additionalProperties: false,
                  description:
                    'Additional structured metadata to keep raw hints (JSON object). Use sparingly.',
                  type: ['object', 'null'],
                },
                narrative: {
                  description:
                    'Factual story of what happened (chronology, participants, outcomes). Required for recall.',
                  type: 'string',
                },
                notes: {
                  description:
                    'Short annotations such as agenda, preparation, or quick bullets distinct from narrative.',
                  type: ['string', 'null'],
                },
                startsAt: {
                  description:
                    'ISO 8601 start time for the activity when specified. Omit if not explicitly provided.',
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
                  description:
                    'IANA timezone string for the start/end times when provided (e.g., "America/New_York").',
                  type: ['string', 'null'],
                },
                type: {
                  description:
                    'Activity type enum. Choose the closest match; fall back to "other" when unclear.',
                  enum: Object.values(ActivityTypeEnum),
                  type: 'string',
                },
              },
              required: [
                'type',
                'narrative',
                'feedback',
                'notes',
                'associatedLocations',
                'associatedSubjects',
                'associatedObjects',
                'startsAt',
                'endsAt',
                'status',
                'tags',
                'timezone',
                'metadata',
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
        type: 'array',
      },
    } satisfies JSONSchema7['properties'],
    required: ['memories'],
    type: 'object',
  },
  strict: true,
};
