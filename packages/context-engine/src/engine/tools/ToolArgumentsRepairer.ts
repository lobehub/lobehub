import type { LobeToolManifest } from './types';

/**
 * JSON Schema type for tool parameters
 */
export interface ToolParameterSchema {
  properties?: Record<string, unknown>;
  required?: string[];
  type?: string;
}

/**
 * Safe JSON parse utility
 */
const safeParseJSON = <T = Record<string, unknown>>(text?: string): T | undefined => {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

/**
 * Tool Arguments Repairer
 *
 * Handles repair of malformed tool call arguments caused by LLM string escape issues.
 *
 * When some LLMs (like Claude haiku-4.5) output tool calls, they may produce malformed JSON
 * where the entire content gets stuffed into the first field with escaped quotes.
 *
 * @example Malformed data:
 * ```javascript
 * { description: 'real desc", "instruction": "real instruction", "timeout": 120}' }
 * ```
 *
 * @example Expected data:
 * ```javascript
 * { description: 'real desc', instruction: 'real instruction', timeout: 120 }
 * ```
 *
 * @example Usage:
 * ```typescript
 * const repairer = new ToolArgumentsRepairer(manifest);
 * const args = repairer.parse('execTask', argumentsString);
 * ```
 */
export class ToolArgumentsRepairer {
  private manifest?: LobeToolManifest;

  /**
   * Create a new ToolArgumentsRepairer
   * @param manifest - Tool manifest for schema lookup
   */
  constructor(manifest?: LobeToolManifest) {
    this.manifest = manifest;
  }

  /**
   * Parse and repair tool call arguments
   *
   * @param apiName - API name
   * @param argumentsStr - Raw arguments string from LLM
   * @returns Parsed and repaired arguments object
   */
  parse(apiName: string, argumentsStr: string): Record<string, unknown> {
    const parsed = safeParseJSON<Record<string, unknown>>(argumentsStr) || {};

    // Get API schema for repair
    const apiSchema = this.manifest?.api?.find((a) => a.name === apiName)?.parameters;

    return this.repair(parsed, apiSchema);
  }

  /**
   * Repair malformed arguments using schema
   *
   * @param parsed - The parsed (but potentially malformed) arguments object
   * @param schema - The JSON schema for the tool's parameters (with required fields)
   * @returns The repaired arguments object
   */
  repair(parsed: Record<string, unknown>, schema?: ToolParameterSchema): Record<string, unknown> {
    // If no schema or no required fields, skip repair
    if (!schema?.required || !Array.isArray(schema.required) || schema.required.length === 0) {
      return parsed;
    }

    const keys = Object.keys(parsed);
    const missingFields = schema.required.filter((f) => !(f in parsed));

    // If no missing required fields, no need to repair
    if (missingFields.length === 0) {
      return parsed;
    }

    // Check if any existing field's value contains the missing field patterns
    // This indicates the string escape issue
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value !== 'string') continue;

      // Check if value contains patterns like `", "missingField":` or `", \"missingField\":`
      const hasMissingFieldPattern = missingFields.some(
        (field) => value.includes(`", "${field}":`) || value.includes(`", \\"${field}\\":`),
      );

      if (hasMissingFieldPattern) {
        // Try to reconstruct the correct JSON
        // The value is actually: 'realValue", "field2": "value2", ...}'
        // So we rebuild: '{"key": "realValue", "field2": "value2", ...}'
        try {
          const reconstructed = `{"${key}": "${value}`;
          const repaired = JSON.parse(reconstructed) as Record<string, unknown>;

          // Verify the repair was successful - all required fields should be present
          const stillMissing = schema.required.filter((f) => !(f in repaired));
          if (stillMissing.length === 0) {
            return repaired;
          }
        } catch {
          // Repair failed, continue to try other approaches or return original
        }
      }
    }

    // Could not repair, return original parsed data
    return parsed;
  }
}
