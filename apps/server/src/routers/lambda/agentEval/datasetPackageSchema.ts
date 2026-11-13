import type { AgentEvalDatasetPackage } from '@lobechat/types';
import { z } from 'zod';

import {
  evalCaseEnvironmentSchema,
  evalConfigSchema,
  evalTestCaseContentSchema,
  rubricTypeSchema,
} from './schemas';

const key = z.string().trim().min(1).max(200);
const portableEnvironmentSchema = evalCaseEnvironmentSchema.omit({ connectorBindings: true });
const connectionReferenceSchema = z.record(
  key,
  z.object({ connectionKey: key, transport: z.enum(['mcp', 'lobe-bench']).optional() }).strict(),
);
const credentialValue = z
  .string()
  .min(1)
  .max(16384)
  .refine((value) => !/[\r\n]/.test(value));
const connectionSchema = z
  .object({
    credentials: z
      .discriminatedUnion('type', [
        z.object({ token: credentialValue, type: z.literal('bearer') }).strict(),
        z
          .object({
            headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/), credentialValue),
            type: z.literal('header'),
          })
          .strict(),
      ])
      .optional(),
    name: z.string().trim().min(1).max(200),
    url: z
      .url()
      .max(8192)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, 'Use an HTTP MCP address without embedded credentials, query or fragment'),
  })
  .strict();
const packageMetadataSchema = z
  .object({
    mock: z
      .object({
        connectors: z
          .record(
            key,
            z
              .object({
                avatar: z.string().max(2000).optional(),
                description: z.string().max(4000).optional(),
                title: z.string().max(200).optional(),
              })
              .strict(),
          )
          .optional(),
        dataset: key,
      })
      .strict()
      .optional(),
    presentation: key.optional(),
    release: key.optional(),
  })
  .strict();

/** A versioned ZIP envelope preserves structured cases instead of flattening them into columns. */
export const datasetPackageSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            connectionBindings: connectionReferenceSchema.optional(),
            content: evalTestCaseContentSchema.strict().extend({
              environment: portableEnvironmentSchema.optional(),
              input: z.string().min(1),
            }),
            environmentKey: key.optional(),
            evalConfig: evalConfigSchema.optional(),
            evalMode: rubricTypeSchema.optional(),
            key,
            metadata: z
              .object({
                category: z.string().optional(),
                difficulty: z.enum(['easy', 'hard', 'medium']).optional(),
                index: z.number().int().nonnegative().optional(),
                tags: z.array(z.string()).max(100).optional(),
              })
              .strict()
              .optional(),
            sortOrder: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
    connections: z.record(key, connectionSchema).optional(),
    dataset: z
      .object({
        description: z.string().max(10000).optional(),
        evalConfig: evalConfigSchema.optional(),
        evalMode: rubricTypeSchema.optional(),
        metadata: packageMetadataSchema.optional(),
        name: z.string().trim().min(1).max(200),
      })
      .strict(),
    environments: z
      .array(
        z
          .object({
            connectionBindings: connectionReferenceSchema.optional(),
            config: portableEnvironmentSchema,
            description: z.string().max(10000).optional(),
            key,
            name: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(500)
      .default([]),
    format: z.literal('lobehub-eval-dataset'),
    version: z.literal(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const environmentKeys = new Set<string>();
    value.environments.forEach((environment, index) => {
      if (environmentKeys.has(environment.key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Environment keys must be unique',
          path: ['environments', index, 'key'],
        });
      }
      environmentKeys.add(environment.key);
    });
    const caseKeys = new Set<string>();
    value.cases.forEach((testCase, index) => {
      if (!testCase.evalMode && !value.dataset.evalMode) {
        ctx.addIssue({
          code: 'custom',
          message: 'Specify a grading mode on the case or dataset',
          path: ['cases', index, 'evalMode'],
        });
      }
      if (caseKeys.has(testCase.key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Case keys must be unique',
          path: ['cases', index, 'key'],
        });
      }
      caseKeys.add(testCase.key);
      if (testCase.environmentKey && !environmentKeys.has(testCase.environmentKey)) {
        ctx.addIssue({
          code: 'custom',
          message: 'The referenced environment is missing from this package',
          path: ['cases', index, 'environmentKey'],
        });
      }
      // Kept in the schema only to explain the refusal: connections belong to Environments.
      if (Object.keys(testCase.connectionBindings ?? {}).length > 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Mock connections belong to an Environment. A case cannot bind its own; list the services it uses in its Environment instead.',
          path: ['cases', index, 'connectionBindings'],
        });
      }
    });
    for (const item of [...value.environments, ...value.cases]) {
      if (
        Object.values(item.connectionBindings ?? {}).some(
          (binding) => !Object.hasOwn(value.connections ?? {}, binding.connectionKey),
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'A mock binding references a connection missing from this package',
          path: ['connections'],
        });
    }
  });

export const validateDatasetPackage = (manifest: unknown): AgentEvalDatasetPackage => {
  const result = datasetPackageSchema.safeParse(manifest);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue.path.includes('connections') || issue.path.includes('credentials')) {
      throw new Error('Invalid dataset package connection configuration');
    }
    throw new Error(
      `Invalid dataset package at ${issue.path.join('.') || 'root'}: ${issue.message}`,
    );
  }
  return result.data;
};
