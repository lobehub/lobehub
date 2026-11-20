import { z } from 'zod';

import { widgetLayoutSchema } from './layout';
import {
  widgetContentSchema,
  widgetManifestSchema,
  widgetVersionContentSchema,
  widgetViewSchema,
} from './manifest';
import { widgetOutputSchema } from './output';
import { widgetPresetSchema } from './preset';

/**
 * The contract documents published as JSON Schema (draft 2020-12), keyed by
 * the file name under `schema/` in the package.
 */
const WIDGET_JSON_SCHEMA_SOURCES = {
  'content': {
    schema: widgetContentSchema,
    title: 'LobeHub widget content',
    description:
      "A widget's authored content: script, runtime, output contract, manifest and view.",
  },
  'layout': {
    schema: widgetLayoutSchema,
    title: 'LobeHub widget layout',
    description: 'The declarative card template a `data` widget is drawn with (`view.layout`).',
  },
  'manifest': {
    schema: widgetManifestSchema,
    title: 'LobeHub widget manifest',
    description:
      'What a widget script needs to run — credentials, network hosts, params, timeout — and how its output is scheduled and trended.',
  },
  'output': {
    schema: widgetOutputSchema,
    title: 'LobeHub widget output',
    description: 'The one JSON document a widget script prints to stdout.',
  },
  'preset': {
    schema: widgetPresetSchema,
    title: 'LobeHub widget preset',
    description: 'A ready-made widget the gallery lists and installs.',
  },
  'version-content': {
    schema: widgetVersionContentSchema,
    title: 'LobeHub widget draft',
    description:
      'A widget version as a draft records it: the content plus an optional change note.',
  },
  'view': {
    schema: widgetViewSchema,
    title: 'LobeHub widget view',
    description: 'How the card presents the output: chart kind, columns, layout, surface or HTML.',
  },
} satisfies Record<string, { description: string; schema: z.ZodType; title: string }>;

export type WidgetJsonSchemaName = keyof typeof WIDGET_JSON_SCHEMA_SOURCES;

export const WIDGET_JSON_SCHEMA_NAMES = Object.keys(
  WIDGET_JSON_SCHEMA_SOURCES,
) as WidgetJsonSchemaName[];

/**
 * One contract document as JSON Schema, describing what an author may send
 * (the schema's input side).
 *
 * The zod schema stays authoritative: cross-field rules — a param named like
 * an env requirement, a select without options, unique series names, layout
 * node limits, a preset's sample matching its output type — cannot be
 * expressed in JSON Schema and are only enforced when LobeHub validates the
 * content.
 */
export const widgetJsonSchema = (name: WidgetJsonSchemaName): Record<string, unknown> => {
  const { description, schema, title } = WIDGET_JSON_SCHEMA_SOURCES[name];
  const { $schema, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    // Shared pieces (a layout value, an icon name) become $defs instead of repeating per node.
    reused: 'ref',
    target: 'draft-2020-12',
  });
  return { $schema, title, description, ...rest };
};
