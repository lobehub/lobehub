import { z } from 'zod';

import type { ModelParamsOutputSchema } from './standard-parameters';
import { MAX_SEED } from './standard-parameters';

export type ComfyUIWorkflowJSON =
  null | boolean | number | string | ComfyUIWorkflowJSON[] | { [key: string]: ComfyUIWorkflowJSON };

const safeKey = z
  .string()
  .min(1)
  .refine((key) => !['__proto__', 'prototype', 'constructor'].includes(key), {
    message: 'Unsafe object key',
  });
// Check raw keys before Zod's record parser drops special keys such as __proto__.
const safeObjectKeys = z
  .unknown()
  .refine(
    (value) =>
      value === null ||
      typeof value !== 'object' ||
      Object.keys(value).every((key) => safeKey.safeParse(key).success),
    { message: 'Unsafe object key' },
  );
const jsonSchema: z.ZodType<ComfyUIWorkflowJSON> = z.lazy(() =>
  safeObjectKeys.pipe(
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite(),
      z.string(),
      z.array(jsonSchema),
      z.record(safeKey, jsonSchema),
    ]),
  ),
);

export const ComfyUIWorkflowParameterSchema = z.enum([
  'prompt',
  'negativePrompt',
  'seed',
  'width',
  'height',
  'steps',
  'cfg',
  'samplerName',
  'scheduler',
  'strength',
  'imageUrls',
]);
export type ComfyUIWorkflowParameter = z.infer<typeof ComfyUIWorkflowParameterSchema>;

export const ComfyUIWorkflowBindingSchema = z
  .object({
    imageIndex: z.number().int().nonnegative().optional(),
    input: safeKey,
    nodeId: safeKey,
  })
  .strict();
export type ComfyUIWorkflowBinding = z.infer<typeof ComfyUIWorkflowBindingSchema>;

export const ComfyUIWorkflowGraphSchema = safeObjectKeys
  .pipe(
    z.record(
      safeKey,
      z
        .object({
          _meta: z.object({ title: z.string().optional() }).strict().optional(),
          class_type: z.string().min(1),
          inputs: safeObjectKeys.pipe(z.record(safeKey, jsonSchema)),
        })
        .strict(),
    ),
  )
  .superRefine((graph, ctx) => {
    if (Object.keys(graph).length === 0)
      ctx.addIssue({ code: 'custom', message: 'API graph must contain nodes' });
    for (const [nodeId, node] of Object.entries(graph)) {
      for (const [input, value] of Object.entries(node.inputs)) {
        if (!Array.isArray(value)) continue;
        // In API graphs an input array denotes a node-output connection.
        if (
          value.length !== 2 ||
          typeof value[0] !== 'string' ||
          !Number.isInteger(value[1]) ||
          Number(value[1]) < 0 ||
          !Object.hasOwn(graph, value[0])
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `Node ${nodeId}, input ${input}: invalid node connection`,
            path: [nodeId, 'inputs', input],
          });
        }
      }
    }
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (nodeId: string): void => {
      if (active.has(nodeId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Graph contains a cycle at node ${nodeId}`,
          path: [nodeId],
        });
        return;
      }
      if (visited.has(nodeId)) return;
      active.add(nodeId);
      for (const value of Object.values(graph[nodeId].inputs)) {
        if (Array.isArray(value) && typeof value[0] === 'string' && Object.hasOwn(graph, value[0]))
          visit(value[0]);
      }
      active.delete(nodeId);
      visited.add(nodeId);
    };
    for (const nodeId of Object.keys(graph)) visit(nodeId);
  });
export type ComfyUIWorkflowGraph = z.infer<typeof ComfyUIWorkflowGraphSchema>;

export const ComfyUIWorkflowSchema = z
  .object({
    bindings: z
      .object({
        cfg: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        height: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        imageUrls: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        negativePrompt: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        prompt: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        samplerName: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        scheduler: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        seed: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        steps: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        strength: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
        width: z.array(ComfyUIWorkflowBindingSchema).min(1).optional(),
      })
      .strict(),
    graph: ComfyUIWorkflowGraphSchema,
    output: z.object({ imageIndex: z.number().int().nonnegative(), nodeId: safeKey }).strict(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    const targets = new Set<string>();
    for (const [parameter, bindings] of Object.entries(workflow.bindings)) {
      for (const binding of bindings ?? []) {
        const path = ['bindings', parameter];
        const node = workflow.graph[binding.nodeId];
        const target = JSON.stringify([binding.nodeId, binding.input]);
        if (targets.has(target))
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate or conflicting binding: ${binding.nodeId}.${binding.input}`,
            path,
          });
        targets.add(target);
        if (!node || !Object.hasOwn(node.inputs, binding.input)) {
          ctx.addIssue({
            code: 'custom',
            message: `Binding target does not exist: ${binding.nodeId}.${binding.input}`,
            path,
          });
          continue;
        }
        const value = node.inputs[binding.input];
        const expected = [
          'prompt',
          'negativePrompt',
          'samplerName',
          'scheduler',
          'imageUrls',
        ].includes(parameter)
          ? 'string'
          : 'number';
        if (typeof value !== expected)
          ctx.addIssue({
            code: 'custom',
            message: `Binding ${parameter} requires a ${expected} literal at ${binding.nodeId}.${binding.input}`,
            path,
          });
        if ((parameter === 'imageUrls') !== (binding.imageIndex !== undefined)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Only imageUrls bindings require an imageIndex',
            path,
          });
        }
      }
    }
    if (!Object.hasOwn(workflow.graph, workflow.output.nodeId)) {
      ctx.addIssue({
        code: 'custom',
        message: `Selected output node ${workflow.output.nodeId} does not exist`,
        path: ['output', 'nodeId'],
      });
    }
  });
export type ComfyUIWorkflow = z.infer<typeof ComfyUIWorkflowSchema>;

/** Expose only explicitly bound controls. Unbound graph literals remain authoritative. */
export function getComfyUIWorkflowParameters(workflow: ComfyUIWorkflow): ModelParamsOutputSchema {
  const parameters: ModelParamsOutputSchema = { prompt: { default: '' } };
  for (const [key, bindings] of Object.entries(workflow.bindings)) {
    const binding = bindings?.[0];
    if (!binding) continue;
    const value = workflow.graph[binding.nodeId].inputs[binding.input];
    switch (key) {
      case 'prompt':
      case 'negativePrompt':
      case 'samplerName':
      case 'scheduler': {
        parameters[key] = { default: value as string };
        break;
      }
      case 'seed': {
        parameters.seed = { default: null, max: MAX_SEED, min: 0 };
        break;
      }
      case 'imageUrls': {
        parameters.imageUrls = {
          default: [],
          maxCount: Math.max(...bindings!.map((target) => target.imageIndex!)) + 1,
        };
        break;
      }
      case 'width':
      case 'height':
      case 'steps': {
        parameters[key] = {
          default: value as number,
          max: Math.max(value as number, key === 'steps' ? 150 : 8192),
          min: 1,
          step: 1,
        };
        break;
      }
      case 'cfg': {
        parameters.cfg = {
          default: value as number,
          max: Math.max(value as number, 30),
          min: Math.min(value as number, 0),
          step: 0.1,
        };
        break;
      }
      case 'strength': {
        parameters.strength = { default: value as number, max: 1, min: 0, step: 0.01 };
      }
    }
  }
  return parameters;
}
