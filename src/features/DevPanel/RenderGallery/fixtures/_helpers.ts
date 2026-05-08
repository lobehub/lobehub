'use client';

import type { LobeChatPluginApi } from '@lobechat/types';

import type { ToolRenderFixture, ToolRenderFixtureVariant } from '../lifecycleMode';

/**
 * Wrap a single fixture body into the canonical `{ variants: [...] }` shape so
 * APIs that only need one preview state stay terse.
 */
export const single = (
  variant: Omit<ToolRenderFixtureVariant, 'id' | 'label'> & {
    id?: string;
    label?: string;
  } = {},
): ToolRenderFixture => ({
  variants: [{ id: 'default', label: 'Default', ...variant }],
});

/**
 * Author multiple lifecycle-state variants (e.g. success / empty / failure) for
 * an API. Each entry only needs `label`; `id` defaults to a slugified label.
 */
export const variants = (
  list: Array<Omit<ToolRenderFixtureVariant, 'id'> & { id?: string }>,
): ToolRenderFixture => ({
  variants: list.map((variant, index) => ({
    id: variant.id ?? (variant.label.toLowerCase().replaceAll(/\s+/g, '-') || `variant-${index}`),
    ...variant,
  })),
});

export interface ToolsetFixtureModule {
  /** Optional per-API descriptions when the live manifest doesn't carry them. */
  apiList?: Array<Pick<LobeChatPluginApi, 'description' | 'name'>>;
  /** Map of `apiName -> ToolRenderFixture` for this toolset. */
  fixtures: Record<string, ToolRenderFixture>;
  /** Toolset identifier exactly as registered in the builtin tool registry. */
  identifier: string;
  /** Optional toolset-level metadata (used when the manifest doesn't expose one). */
  meta?: { description?: string; title: string };
}

/**
 * Identity helper that gives authors typed autocomplete + structural validation
 * when defining a per-toolset fixture module.
 */
export const defineFixtures = (definition: ToolsetFixtureModule): ToolsetFixtureModule =>
  definition;

const humanize = (value: string) =>
  value
    .replaceAll('_', ' ')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

const buildStringSample = (key: string, schema: any) => {
  if (schema?.format === 'uri' || key.toLowerCase().includes('url')) return 'https://example.com';
  if (key.toLowerCase().includes('path'))
    return `/workspace/${key.replace(/Path$/i, '').toLowerCase() || 'file'}.ts`;
  if (key.toLowerCase().includes('id')) return `${key}-sample`;
  if (key.toLowerCase().includes('query')) return 'tool render preview';
  if (key.toLowerCase().includes('title')) return 'Preview title';
  if (key.toLowerCase().includes('description')) return 'Preview description';
  if (key.toLowerCase().includes('content') || key.toLowerCase().includes('prompt')) {
    return `Sample ${humanize(key).toLowerCase()} for the devtools preview.`;
  }

  return `${humanize(key)} sample`;
};

export const buildSchemaSample = (schema: any, key = 'value'): any => {
  if (!schema) return undefined;
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'array': {
      const item = buildSchemaSample(
        schema.items,
        key.endsWith('s') ? key.slice(0, -1) : `${key}Item`,
      );
      return item === undefined ? [] : [item];
    }
    case 'boolean': {
      return true;
    }
    case 'integer':
    case 'number': {
      return 1;
    }
    case 'object': {
      const properties = schema.properties || {};
      return Object.fromEntries(
        Object.entries(properties)
          .map(([propertyKey, propertySchema]) => [
            propertyKey,
            buildSchemaSample(propertySchema, propertyKey),
          ])
          .filter(([, value]) => value !== undefined),
      );
    }
    case 'string':
    default: {
      return buildStringSample(key, schema);
    }
  }
};

export { humanize };
