import type { NodeDefsResponse } from '@saintno/comfyui-sdk';
import { type ComfyUIWorkflow, ComfyUIWorkflowSchema } from 'model-bank';

const PARAMETER_TYPES: Record<string, string[]> = {
  cfg: ['FLOAT', 'INT'],
  height: ['INT'],
  imageUrls: ['STRING'],
  negativePrompt: ['STRING'],
  prompt: ['STRING'],
  samplerName: ['STRING'],
  scheduler: ['STRING'],
  seed: ['INT'],
  steps: ['INT'],
  strength: ['FLOAT', 'INT'],
  width: ['INT'],
};

/** Validate against the actual installation, including custom loader classes and file enums. */
export function validateComfyUIWorkflow(workflow: ComfyUIWorkflow, definitions: NodeDefsResponse) {
  const parsed = ComfyUIWorkflowSchema.safeParse(workflow);
  if (!parsed.success)
    return { errors: parsed.error.issues.map((issue) => issue.message), valid: false };
  const errors: string[] = [];
  const boundImages = new Set(
    (workflow.bindings.imageUrls ?? []).map((binding) =>
      JSON.stringify([binding.nodeId, binding.input]),
    ),
  );

  for (const [nodeId, node] of Object.entries(workflow.graph)) {
    const definition = Object.hasOwn(definitions, node.class_type)
      ? definitions[node.class_type]
      : undefined;
    const label = `Node ${nodeId} (${node.class_type})`;
    if (!definition) {
      errors.push(`${label}: node class is not installed`);
      continue;
    }
    const inputs = { ...definition.input.required, ...definition.input.optional };
    for (const input of Object.keys(definition.input.required)) {
      if (!Object.hasOwn(node.inputs, input))
        errors.push(`${label}: missing required input ${input}`);
    }
    for (const [input, value] of Object.entries(node.inputs)) {
      const spec = inputs[input];
      if (!spec) {
        errors.push(`${label}: unknown input ${input}`);
        continue;
      }
      const [kind, options] = spec;
      const type = Array.isArray(kind) ? 'STRING' : kind;
      if (Array.isArray(value)) {
        const source = workflow.graph[value[0] as string];
        const sourceDefinition =
          source && Object.hasOwn(definitions, source.class_type)
            ? definitions[source.class_type]
            : undefined;
        const outputType = sourceDefinition?.output[value[1] as number];
        if (!outputType)
          errors.push(
            `${label}, input ${input}: source output ${value[0]}[${value[1]}] does not exist`,
          );
        // ComfyUI accepts MatchType links in either direction; these ports are dynamic.
        else if (
          type !== '*' &&
          outputType !== '*' &&
          type !== 'COMFY_MATCHTYPE_V3' &&
          outputType !== 'COMFY_MATCHTYPE_V3' &&
          !type.split(',').includes(outputType)
        ) {
          errors.push(
            `${label}, input ${input}: expected ${type}, connected output is ${outputType}`,
          );
        }
        continue;
      }
      if (Array.isArray(kind)) {
        // Reference files will be uploaded at execution; their saved placeholders need not exist.
        if (!boundImages.has(JSON.stringify([nodeId, input])) && !kind.includes(value as string)) {
          errors.push(
            `${label}, input ${input}: value ${JSON.stringify(value)} is not available on this server (check installed model, VAE, encoder or option)`,
          );
        }
      } else if (
        (type === 'STRING' && typeof value !== 'string') ||
        (type === 'BOOLEAN' && typeof value !== 'boolean') ||
        ((type === 'INT' || type === 'FLOAT') &&
          (typeof value !== 'number' || (type === 'INT' && !Number.isInteger(value))))
      ) {
        errors.push(`${label}, input ${input}: expected ${type}`);
      } else if (typeof value === 'number' && (type === 'INT' || type === 'FLOAT')) {
        const limits = options as { max?: number; min?: number } | undefined;
        if (limits?.min !== undefined && value < limits.min)
          errors.push(`${label}, input ${input}: must be at least ${limits.min}`);
        if (limits?.max !== undefined && value > limits.max)
          errors.push(`${label}, input ${input}: must be at most ${limits.max}`);
      } else if (!['STRING', 'BOOLEAN', '*'].includes(type)) {
        errors.push(`${label}, input ${input}: ${type} requires a node-output connection`);
      }
    }
  }

  for (const [parameter, bindings] of Object.entries(workflow.bindings)) {
    for (const binding of bindings ?? []) {
      const node = workflow.graph[binding.nodeId];
      const definition = Object.hasOwn(definitions, node.class_type)
        ? definitions[node.class_type]
        : undefined;
      const spec =
        definition?.input.required[binding.input] ?? definition?.input.optional?.[binding.input];
      if (!spec) continue;
      const type = Array.isArray(spec[0]) ? 'STRING' : spec[0];
      if (!PARAMETER_TYPES[parameter].includes(type))
        errors.push(
          `Binding ${parameter} to ${binding.nodeId}.${binding.input}: expected ${PARAMETER_TYPES[parameter].join(' or ')}, server input is ${type}`,
        );
    }
  }

  const outputNode = workflow.graph[workflow.output.nodeId];
  const outputDefinition = Object.hasOwn(definitions, outputNode.class_type)
    ? definitions[outputNode.class_type]
    : undefined;
  if (outputDefinition && !outputDefinition.output_node)
    errors.push(`Selected node ${workflow.output.nodeId} is not an output node`);
  return { errors, valid: errors.length === 0 };
}
