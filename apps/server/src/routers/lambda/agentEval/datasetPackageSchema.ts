import type { AgentEvalDatasetPackage } from '@lobechat/types';
import { z } from 'zod';

import {
  evalCaseEnvironmentSchema,
  evalConfigSchema,
  evalTestCaseContentSchema,
  rubricTypeSchema,
} from './schemas';

const key = z.string().trim().min(1).max(200);
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
            content: evalTestCaseContentSchema.strict().extend({ input: z.string().min(1) }),
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
            config: evalCaseEnvironmentSchema,
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
    });
    const environments = [
      ...value.environments.map((environment) => environment.config),
      ...value.cases.map((testCase) => testCase.content.environment),
    ];
    if (
      !value.dataset.metadata?.mock &&
      environments.some(
        (environment) =>
          environment?.mock?.services.length ||
          Object.keys(environment?.toolForwarding ?? {}).length,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Packages using mock tools must specify dataset.metadata.mock.dataset',
        path: ['dataset', 'metadata', 'mock'],
      });
    }
  });

export const validateDatasetPackage = (manifest: unknown): AgentEvalDatasetPackage => {
  const result = datasetPackageSchema.safeParse(manifest);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Invalid dataset package at ${issue.path.join('.') || 'root'}: ${issue.message}`,
    );
  }
  return result.data;
};
