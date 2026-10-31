import { z } from 'zod';

import { evalMemoryFixtureSchema } from '@/server/services/agentEvalRun/evalMemory.schema';

export const rubricTypeSchema = z.enum([
  'equals',
  'contains',
  'regex',
  'starts-with',
  'ends-with',
  'any-of',
  'numeric',
  'extract-match',
  'json-schema',
  'javascript',
  'python',
  'llm-rubric',
  'rule-checklist',
  'factuality',
  'answer-relevance',
  'similar',
  'levenshtein',
  'rubric',
  'external',
]);

export const evalConfigSchema = z.object({ judgePrompt: z.string().optional() }).passthrough();

export const evalCaseAgentConfigSchema = z
  .object({
    memory: z
      .object({
        effort: z.enum(['low', 'medium', 'high']).optional(),
        enabled: z.boolean().optional(),
        toolPermission: z.enum(['read-only', 'read-write']).optional(),
      })
      .strict()
      .optional(),
    name: z.string().trim().min(1).max(200).optional(),
    plugins: z.array(z.string().trim().min(1)).optional(),
    systemRole: z.string().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const evalCaseEnvironmentSchema = z
  .object({
    agent: evalCaseAgentConfigSchema.optional(),
    envPrompt: z.string().optional(),
    memory: evalMemoryFixtureSchema.optional(),
    mock: z
      .object({ services: z.array(z.string().trim().min(1)).min(1) })
      .strict()
      .optional(),
    sessionDate: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'sessionDate must be an ISO date')
      .optional(),
    timezone: z.string().trim().min(1).optional(),
    // Which connectors are forwarded and with what timeout. Where they are
    // forwarded to is the server's trusted mock (EVAL_TOOL_MOCK_BASE_URL); an
    // `endpoint` supplied here is rejected rather than trusted.
    toolForwarding: z
      .record(
        z.string().trim().min(1),
        z.object({ timeoutMs: z.number().int().positive().optional() }).strict(),
      )
      .optional(),
  })
  .strict();

const dateValueSchema = z.union([
  z.number().finite(),
  z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp'),
]);

const recordSchema = z.record(z.string(), z.unknown());

export const evalTestCaseMessagesSchema = z
  .array(
    z
      .object({
        content: z.string(),
        createdAt: dateValueSchema.optional(),
        error: recordSchema.optional(),
        id: z.string().min(1).optional(),
        metadata: recordSchema.optional(),
        model: z.string().optional(),
        parentId: z.string().min(1).nullable().optional(),
        plugin: recordSchema.optional(),
        pluginError: recordSchema.optional(),
        pluginIntervention: recordSchema.optional(),
        pluginState: recordSchema.optional(),
        provider: z.string().optional(),
        reasoning: recordSchema.optional(),
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        search: recordSchema.optional(),
        tool_call_id: z.string().optional(),
        tools: z.array(recordSchema).optional(),
        traceId: z.string().optional(),
        updatedAt: dateValueSchema.optional(),
      })
      .strict(),
  )
  .superRefine((messages, ctx) => {
    const ids = new Set<string>();

    for (const [index, message] of messages.entries()) {
      if (!message.id) continue;
      if (ids.has(message.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Message ids must be unique',
          path: [index, 'id'],
        });
      }
      ids.add(message.id);
    }

    for (const [index, message] of messages.entries()) {
      if (message.parentId && !ids.has(message.parentId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Message parentId must reference a message in the same sequence',
          path: [index, 'parentId'],
        });
      }
    }
  });

export const evalTestCaseContentSchema = z.object({
  category: z.string().optional(),
  choices: z.array(z.string()).optional(),
  environment: evalCaseEnvironmentSchema.optional(),
  expected: z.string().optional(),
  input: z.string(),
  messages: evalTestCaseMessagesSchema.optional(),
});
