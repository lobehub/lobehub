import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    placeholderVariablesProcessed?: number;
  }
}

const log = debug('context-engine:processor:PlaceholderVariablesProcessor');

const PLACEHOLDER_START = '{{';
const PLACEHOLDER_END = '}}';

interface PlaceholderToken {
  end: number;
  key: string;
  raw: string;
  start: number;
}

export type PlaceholderValue = unknown | (() => unknown);
export type PlaceholderValueMap = Record<string, PlaceholderValue>;

const formatPlaceholderPrimitive = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => formatPlaceholderPrimitive(item))
      .filter((item) => item.length > 0)
      .join(', ');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return String(value);
};

const resolvePlaceholderValue = (value: PlaceholderValue): string => {
  try {
    const resolved = typeof value === 'function' ? value() : value;
    return formatPlaceholderPrimitive(resolved);
  } catch {
    return '';
  }
};

export const buildPlaceholderGenerators = (
  values: PlaceholderValueMap,
): Record<string, () => string> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, () => resolvePlaceholderValue(value)]),
  );

export const formatPlaceholderValues = (values: PlaceholderValueMap): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, resolvePlaceholderValue(value)]),
  );

export interface PlaceholderVariablesConfig {
  /** Recursive parsing depth, default is 2 */
  depth?: number;
  /** Variable generators mapping, key is variable name, value is generator function */
  variableGenerators: Record<string, () => string>;
}

/**
 * Extract all {{variable}} placeholder variable names from text
 * @param text String containing template variables
 * @returns Array of variable names, e.g. ['date', 'nickname']
 */
const extractPlaceholderTokens = (text: string): PlaceholderToken[] => {
  const tokens: PlaceholderToken[] = [];
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const start = text.indexOf(PLACEHOLDER_START, searchIndex);
    if (start === -1) break;

    const end = text.indexOf(PLACEHOLDER_END, start + PLACEHOLDER_START.length);
    if (end === -1) break;

    const tokenEnd = end + PLACEHOLDER_END.length;
    tokens.push({
      end: tokenEnd,
      key: text.slice(start + PLACEHOLDER_START.length, end).trim(),
      raw: text.slice(start, tokenEnd),
      start,
    });

    searchIndex = tokenEnd;
  }

  return tokens;
};

const replaceAvailablePlaceholders = (
  text: string,
  placeholders: PlaceholderToken[],
  availableVariables: Record<string, string>,
): string => {
  const output: string[] = [];
  let cursor = 0;
  let changed = false;

  for (const placeholder of placeholders) {
    output.push(text.slice(cursor, placeholder.start));

    if (Object.hasOwn(availableVariables, placeholder.key)) {
      output.push(availableVariables[placeholder.key]);
      changed = true;
    } else {
      output.push(placeholder.raw);
    }

    cursor = placeholder.end;
  }

  output.push(text.slice(cursor));

  return changed ? output.join('') : text;
};

/**
 * Replace template variables with actual values, supporting recursive parsing of nested variables
 * @param text - Original text containing variables
 * @param variableGenerators - Variable generators mapping
 * @param depth - Recursive depth, default 2, set higher to support {{date}} within {{text}}
 * @returns Text with variables replaced
 */
export const parsePlaceholderVariables = (
  text: string,
  variableGenerators: Record<string, () => string>,
  depth = 2,
): string => {
  let result = text;

  // Recursive parsing to handle cases like {{text}} containing additional preset variables
  for (let i = 0; i < depth; i++) {
    try {
      const placeholders = extractPlaceholderTokens(result);
      const extractedVariables = placeholders.map((placeholder) => placeholder.key);

      if (placeholders.length === 0) break;

      log('Extracted variables from text: %o', extractedVariables);
      log('Available generator keys: %o', Object.keys(variableGenerators));

      // Debug: check if text contains {{username}} pattern
      if (result.includes('username') || result.includes('{{')) {
        const matches = placeholders.map((placeholder) => placeholder.raw);
        log('All {{...}} patterns found in text: %o', matches);
      }

      const availableVariables = Object.fromEntries(
        extractedVariables
          .map((key) => {
            const generator = variableGenerators[key];
            const value = generator?.();
            log('Variable "%s": generator=%s, value=%s', key, !!generator, value);
            return [key, value];
          })
          .filter(([, value]) => value !== undefined),
      );

      log('Available variables after filtering: %o', availableVariables);

      // Only perform replacement when there are available variables
      if (Object.keys(availableVariables).length === 0) break;

      const tempResult = replaceAvailablePlaceholders(result, placeholders, availableVariables);

      if (tempResult === result) break;
      result = tempResult;
    } catch {
      break;
    }
  }

  return result;
};

/**
 * Convenience helper to render a template string with placeholder values
 * @param template Template string containing {{variable}} tokens
 * @param values Key-value map or generator map used for replacement
 * @param depth Recursive depth
 */
export const renderPlaceholderTemplate = (
  template: string,
  values: PlaceholderValueMap,
  depth = 2,
): string => parsePlaceholderVariables(template, buildPlaceholderGenerators(values), depth);

/**
 * Parse message content and replace placeholder variables
 * @param messages Original messages array
 * @param variableGenerators Variable generators mapping
 * @param depth Recursive parsing depth, default is 2
 * @returns Processed messages array
 */
export const parsePlaceholderVariablesMessages = (
  messages: any[],
  variableGenerators: Record<string, () => string>,
  depth = 2,
): any[] =>
  messages.map((message) => {
    if (!message?.content) return message;

    const { content } = message;

    // Handle string type directly
    if (typeof content === 'string') {
      return { ...message, content: parsePlaceholderVariables(content, variableGenerators, depth) };
    }

    // Handle array type by processing text elements
    if (Array.isArray(content)) {
      return {
        ...message,
        content: content.map((item) =>
          item?.type === 'text'
            ? { ...item, text: parsePlaceholderVariables(item.text, variableGenerators, depth) }
            : item,
        ),
      };
    }

    return message;
  });

/**
 * PlaceholderVariables Processor
 * Responsible for handling placeholder variable replacement in messages
 */
export class PlaceholderVariablesProcessor extends BaseProcessor {
  readonly name = 'PlaceholderVariablesProcessor';

  constructor(
    private config: PlaceholderVariablesConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    const depth = this.config.depth ?? 2;

    log(
      `Starting placeholder variables processing with ${Object.keys(this.config.variableGenerators).length} generators`,
    );
    log('Generator keys: %o', Object.keys(this.config.variableGenerators));

    // Process placeholder variables for each message
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      log(
        'Processing message %d: role=%s, contentType=%s, contentPreview=%s',
        i,
        message.role,
        typeof message.content,
        typeof message.content === 'string'
          ? message.content.slice(0, 200)
          : JSON.stringify(message.content).slice(0, 200),
      );

      try {
        const originalMessage = JSON.stringify(message);
        const processedMessage = this.processMessagePlaceholders(message, depth);

        if (JSON.stringify(processedMessage) !== originalMessage) {
          clonedContext.messages[i] = processedMessage;
          processedCount++;
          log(`Processed placeholders in message ${message.id}, role: ${message.role}`);
        } else {
          log(`No placeholders found/replaced in message ${message.id}, role: ${message.role}`);
        }
      } catch (error) {
        log.extend('error')(`Error processing placeholders in message ${message.id}: ${error}`);
        // Continue processing other messages
      }
    }

    // Update metadata
    clonedContext.metadata.placeholderVariablesProcessed = processedCount;

    log(`Placeholder variables processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Process placeholder variables for a single message
   */
  private processMessagePlaceholders(message: any, depth: number): any {
    if (!message?.content) return message;

    const { content } = message;

    // Handle string type directly
    if (typeof content === 'string') {
      return {
        ...message,
        content: parsePlaceholderVariables(content, this.config.variableGenerators, depth),
      };
    }

    // Handle array type by processing text elements
    if (Array.isArray(content)) {
      return {
        ...message,
        content: content.map((item) =>
          item?.type === 'text'
            ? {
                ...item,
                text: parsePlaceholderVariables(item.text, this.config.variableGenerators, depth),
              }
            : item,
        ),
      };
    }

    return message;
  }
}
