import { ToolNameResolver } from './ToolNameResolver';
import type { LobeToolManifest, UniformTool } from './types';

// Create a singleton instance for backward compatibility
const resolver = new ToolNameResolver();

/**
 * Generate tool calling name
 * @deprecated Use ToolNameResolver.generate() instead
 */
export const generateToolName = (
  identifier: string,
  name: string,
  type: string = 'default',
): string => {
  return resolver.generate(identifier, name, type);
};

/**
 * Normalize tool parameters to be provider-safe.
 *
 * JSON Schema permits omitting `required` when nothing is required, but
 * some OpenAI-compatible upstreams (bailian, glm/zhipu) reject the field when
 * it arrives as `null` after intermediate proxies normalize the missing key.
 * Emitting `required: []` keeps the wire format consistent for strict providers.
 *
 * Additionally ensures `properties` is always a non-null object when `type`
 * is 'object', preventing strict providers (Anthropic, MiniMax M3) from
 * silently dropping or misinterpreting the parameter schema.
 */
export const normalizeToolParameters = (
  parameters: Record<string, any> | undefined,
): Record<string, any> | undefined => {
  if (!parameters || parameters.type !== 'object') return parameters;

  const properties = parameters.properties ?? {};
  const safeProperties =
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? properties
      : {};

  const required = Array.isArray(parameters.required) ? parameters.required : [];

  // Filter required fields to only those that exist in properties
  const safeRequired = required.filter((key: string) => key in safeProperties);

  return {
    ...parameters,
    properties: safeProperties,
    required: safeRequired,
  };
};

/**
 * Convert a tool manifest into LLM-compatible UniformTool definitions
 */
export function generateToolsFromManifest(manifest: LobeToolManifest): UniformTool[] {
  return manifest.api.map((api) => ({
    function: {
      description: api.description,
      name: new ToolNameResolver().generate(manifest.identifier, api.name, manifest.type),
      parameters: normalizeToolParameters(api.parameters),
    },
    type: 'function' as const,
  }));
}

/**
 * Validate manifest schema structure
 */
export function validateManifest(manifest: any): manifest is LobeToolManifest {
  return Boolean(
    manifest &&
    typeof manifest === 'object' &&
    typeof manifest.identifier === 'string' &&
    Array.isArray(manifest.api) &&
    manifest.api.length > 0,
  );
}

/**
 * Filter valid manifest schemas
 */
export function filterValidManifests(manifestSchemas: any[]): {
  invalid: any[];
  valid: LobeToolManifest[];
} {
  const valid: LobeToolManifest[] = [];
  const invalid: any[] = [];

  for (const manifest of manifestSchemas) {
    if (validateManifest(manifest)) {
      valid.push(manifest);
    } else {
      invalid.push(manifest);
    }
  }

  return { invalid, valid };
}
