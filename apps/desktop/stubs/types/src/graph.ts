import Ajv from 'ajv';
import { z } from 'zod';

/**
 * Runtime mirror of `packages/types/src/agent/graph.ts` for the isolated desktop
 * workspace. Keep the validation behavior in sync with the canonical schema.
 */

export const AGENT_GRAPH_ROOT_NODE_ID = '__root__';

/**
 * Serializable reasoning graph snapshot stored on agent config.
 * Kept package-local so shared config types don't depend on runtime packages.
 */
export type AgentGraphNode =
  | {
      allowedToolApiNames?: string[];
      maxAgentSteps?: number;
      type: 'agent';
    }
  | {
      type: 'llm';
    };

export interface AgentGraphField {
  desc: string;
  schema: Record<string, any>;
}

export interface AgentGraphFieldRef {
  desc?: string;
  field: string;
  required?: boolean;
}

export interface AgentGraphInputField extends AgentGraphFieldRef {
  from: string;
}

export type AgentGraphOutputField = AgentGraphFieldRef;

export interface AgentGraphEdge {
  /**
   * JSON Schema evaluated against the current node output.
   * If omitted, the edge is treated as the default edge for its source node.
   */
  condition?: Record<string, unknown>;
  from: string;
  input?: {
    fields?: AgentGraphInputField[];
  };
  instruction: string;
  maxTraversals?: number;
  output?: {
    fields?: AgentGraphOutputField[];
    instruction?: string;
  };
  to: string;
}

export interface ReasoningGraph {
  description?: string;
  edges: AgentGraphEdge[];
  fields: Record<string, AgentGraphField>;
  maxInstructionCount?: number;
  name: string;
  nodes: Record<string, AgentGraphNode>;
  terminal: string;
}

const AgentGraphNodeSchema = z.discriminatedUnion('type', [
  z.object({
    allowedToolApiNames: z.array(z.string().min(1)).optional(),
    maxAgentSteps: z.number().int().positive().optional(),
    type: z.literal('agent'),
  }),
  z.object({
    type: z.literal('llm'),
  }),
]);

const AgentGraphFieldSchema = z.object({
  desc: z.string().min(1),
  schema: z.record(z.unknown()),
});

const AgentGraphFieldRefSchema = z.object({
  desc: z.string().min(1).optional(),
  field: z.string().min(1),
  required: z.boolean().optional(),
});

const AgentGraphInputFieldSchema = AgentGraphFieldRefSchema.extend({
  from: z.string().min(1),
});

const AgentGraphOutputFieldSchema = AgentGraphFieldRefSchema;

const AgentGraphEdgeSchema = z.object({
  condition: z.record(z.unknown()).optional(),
  from: z.string(),
  input: z
    .object({
      fields: z.array(AgentGraphInputFieldSchema).optional(),
    })
    .optional(),
  output: z
    .object({
      fields: z.array(AgentGraphOutputFieldSchema).optional(),
      instruction: z.string().min(1).optional(),
    })
    .optional(),
  instruction: z.string().min(1),
  maxTraversals: z.number().int().nonnegative().optional(),
  to: z.string(),
});

const findSchemaDescriptionPath = (
  value: unknown,
  path: (number | string)[],
): (number | string)[] | undefined => {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSchemaDescriptionPath(item, [...path, index]);
      if (found) return found;
    }

    return;
  }

  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, 'description') && path.at(-1) !== 'properties') {
    return [...path, 'description'];
  }

  for (const [key, item] of Object.entries(record)) {
    const found = findSchemaDescriptionPath(item, [...path, key]);
    if (found) return found;
  }
};

export const ReasoningGraphSchema = z
  .object({
    description: z.string().optional(),
    fields: z.record(AgentGraphFieldSchema),
    maxInstructionCount: z.number().int().positive().optional(),
    name: z.string().min(1),
    nodes: z.record(AgentGraphNodeSchema),
    terminal: z.string().min(1),
    edges: z.array(AgentGraphEdgeSchema),
  })
  .superRefine((graph, ctx) => {
    const outputSchemaAjv = new Ajv({ allErrors: false, strict: false });
    const conditionSchemaAjv = new Ajv({ allErrors: false, strict: true });
    const fieldIds = new Set(Object.keys(graph.fields));
    const nodeIds = new Set(Object.keys(graph.nodes));
    const sourceNodeIds = new Set([AGENT_GRAPH_ROOT_NODE_ID, ...nodeIds]);

    for (const [fieldId, field] of Object.entries(graph.fields)) {
      const descriptionPath = findSchemaDescriptionPath(field.schema, [
        'fields',
        fieldId,
        'schema',
      ]);
      if (descriptionPath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Graph field "${fieldId}" schema must not contain "description"; ` +
            'field schemas are only for validation. Use the graph field desc or edge field desc instead.',
          path: descriptionPath,
        });
      }

      try {
        outputSchemaAjv.compile(field.schema);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `Graph field "${fieldId}" schema must be a valid JSON Schema: ` +
            (error instanceof Error ? error.message : String(error)),
          path: ['fields', fieldId, 'schema'],
        });
      }
    }

    if (nodeIds.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Graph must define at least one node',
        path: ['nodes'],
      });
      return;
    }

    if (!nodeIds.has(graph.terminal)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Graph terminal must reference an existing node',
        path: ['terminal'],
      });
    }

    const rootEdges = graph.edges.filter((edge) => edge.from === AGENT_GRAPH_ROOT_NODE_ID);
    if (rootEdges.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Graph must define exactly one "${AGENT_GRAPH_ROOT_NODE_ID}" outgoing edge`,
        path: ['edges'],
      });
    }

    const defaultEdgeBySource = new Map<string, number>();
    graph.edges.forEach((edge, index) => {
      if (edge.condition) {
        try {
          conditionSchemaAjv.compile(edge.condition);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Edge condition must be a valid JSON Schema: ` +
              (error instanceof Error ? error.message : String(error)),
            path: ['edges', index, 'condition'],
          });
        }
      }

      if (!edge.condition) {
        const previousIndex = defaultEdgeBySource.get(edge.from);
        if (previousIndex !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Only one default edge without condition is allowed from "${edge.from}"`,
            path: ['edges', index, 'condition'],
          });
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Only one default edge without condition is allowed from "${edge.from}"`,
            path: ['edges', previousIndex, 'condition'],
          });
        }
        defaultEdgeBySource.set(edge.from, index);
      }

      if (edge.from !== AGENT_GRAPH_ROOT_NODE_ID && !nodeIds.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge from must reference an existing node or "${AGENT_GRAPH_ROOT_NODE_ID}"`,
          path: ['edges', index, 'from'],
        });
      }

      if (!nodeIds.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Edge to must reference an existing node',
          path: ['edges', index, 'to'],
        });
      }

      const inputFields = edge.input?.fields;
      if (inputFields && inputFields.length > 0) {
        const names = new Set<string>();
        inputFields.forEach((field, fieldIndex) => {
          if (names.has(field.field)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Edge input field "${field.field}" is duplicated`,
              path: ['edges', index, 'input', 'fields', fieldIndex, 'field'],
            });
          }
          names.add(field.field);

          if (!fieldIds.has(field.field)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Edge input field "${field.field}" must reference a registered graph field`,
              path: ['edges', index, 'input', 'fields', fieldIndex, 'field'],
            });
          }

          if (!sourceNodeIds.has(field.from)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Edge input source node "${field.from}" must reference an existing node or "${AGENT_GRAPH_ROOT_NODE_ID}"`,
              path: ['edges', index, 'input', 'fields', fieldIndex, 'from'],
            });
          }
        });
      }

      const outputFields = edge.output?.fields;
      if (outputFields && outputFields.length > 0) {
        const names = new Set<string>();
        outputFields.forEach((field, fieldIndex) => {
          if (names.has(field.field)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Edge output field "${field.field}" is duplicated`,
              path: ['edges', index, 'output', 'fields', fieldIndex, 'field'],
            });
          }
          names.add(field.field);

          if (!fieldIds.has(field.field)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Edge output field "${field.field}" must reference a registered graph field`,
              path: ['edges', index, 'output', 'fields', fieldIndex, 'field'],
            });
          }
        });
      }
    });
  });
