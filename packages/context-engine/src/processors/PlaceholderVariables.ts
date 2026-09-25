import { PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const/plugin';
import { truncateSurrogateSafe } from '@lobechat/utils';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    placeholderVariablesProcessed?: number;
  }
}

const log = debug('context-engine:processor:PlaceholderVariablesProcessor');

const CONTENT_PREVIEW_LENGTH = 200;

/**
 * Build a short, log-safe preview of a message's content.
 *
 * `JSON.stringify` returns `undefined` (not a string) for `undefined` /
 * functions / symbols, so naively calling `.slice` on its result crashes —
 * this is exactly how a tool error result with `content: undefined`
 * (e.g. budget-exceeded errors) used to take down the whole processor.
 * Always coerce to a string before slicing, and cut surrogate-safely so a
 * mid-emoji slice cannot leave a lone surrogate in the preview.
 */
export const buildContentPreview = (content: unknown): string => {
  if (typeof content === 'string') return truncateSurrogateSafe(content, CONTENT_PREVIEW_LENGTH);

  try {
    const serialized = JSON.stringify(content);
    return truncateSurrogateSafe(serialized ?? String(content), CONTENT_PREVIEW_LENGTH);
  } catch {
    return truncateSurrogateSafe(String(content), CONTENT_PREVIEW_LENGTH);
  }
};

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

/**
 * Tool results whose content is a platform-authored *template* that still needs
 * hydrating at the payload boundary.
 *
 * Every other tool result is a *record* of what a tool actually returned, and
 * must be handed to the model byte-for-byte. Substituting into it is wrong on
 * two counts:
 *
 * 1. It lies. An agent that runs `git diff` over a locale file holding
 *    `"Updated {{time}}"` should see that file's real contents, not the
 *    harness's clock.
 * 2. It breaks the prompt cache, permanently. The value moves between calls, so
 *    the rewritten message diverges from the prefix the provider has already
 *    cached, and every token after it is re-processed at the uncached price for
 *    the rest of the run. That exact diff broke the prefix on 134 of 136 calls
 *    of one operation — 43M re-processed tokens, $15 for a single run.
 *
 * Keyed by tool identifier → API names. This is the same activation surface
 * `ActivationResultTrimProcessor` recognises: an activated skill that is NOT
 * injected into the system prompt keeps its tool result as the only channel for
 * the SKILL.md body, and that body references `{{agent_id}}` / `{{topic_id}}`.
 */
export const HYDRATED_TOOL_RESULTS: Readonly<Record<string, readonly string[]>> = {
  // Literal copies of `LobeActivatorIdentifier` / `SkillsIdentifier` — same
  // rationale as ActivationResultTrimProcessor: both are frozen wire values,
  // and importing the tool packages here would invert the dependency.
  'lobe-activator': ['activateTools', 'activateSkill'],
  'lobe-skills': ['activateSkill'],
};

/**
 * Resolve a tool result's `(identifier, apiName)`.
 *
 * Prefers `foldedToolResult` — set when a role conversion moved the result into
 * another role's content (GroupRoleTransformProcessor turns another agent's
 * tool results into `role: 'user'` and drops `plugin`), then the structured
 * `plugin` field the flatten processors re-attach, and finally the wire name
 * (`identifier____apiName`) for payload-shaped messages carrying neither.
 */
const resolveToolIdentity = (message: any): { apiName?: string; identifier?: string } => {
  const folded = message?.foldedToolResult as { apiName?: string; identifier?: string } | undefined;
  if (folded) return { apiName: folded.apiName, identifier: folded.identifier };

  const plugin = message?.plugin as { apiName?: string; identifier?: string } | undefined;
  if (plugin?.identifier) return { apiName: plugin.apiName, identifier: plugin.identifier };

  const name = message?.name;
  if (typeof name === 'string' && name.includes(PLUGIN_SCHEMA_SEPARATOR)) {
    const [identifier, apiName] = name.split(PLUGIN_SCHEMA_SEPARATOR);
    return { apiName, identifier };
  }

  return {};
};

export interface PlaceholderVariablesConfig {
  /** Recursive parsing depth, default is 2 */
  depth?: number;
  /**
   * Tool identifier → API names whose `role: 'tool'` results get hydrated.
   * Defaults to {@link HYDRATED_TOOL_RESULTS}; every tool result outside it is
   * passed through untouched.
   */
  hydratedToolResults?: Readonly<Record<string, readonly string[]>>;
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
 * Extract placeholder variable names from a message that are NOT in the
 * generator set (i.e. likely user typos or missing config).
 *
 * Used for diagnostic reporting — not for replacement logic.
 */
const extractUnresolvedPlaceholderNames = (message: any, generatorKeys: string[]): string[] => {
  const generatorSet = new Set(generatorKeys);
  const texts: string[] = [];

  if (typeof message?.content === 'string') {
    texts.push(message.content);
  } else if (Array.isArray(message?.content)) {
    for (const item of message.content) {
      if (item?.type === 'text' && typeof item.text === 'string') {
        texts.push(item.text);
      }
    }
  }

  const unresolved = new Set<string>();
  for (const text of texts) {
    const tokens = extractPlaceholderTokens(text);
    for (const token of tokens) {
      if (!generatorSet.has(token.key)) {
        unresolved.add(token.key);
      }
    }
  }

  return [...unresolved];
};

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

  /**
   * Whether a message's `{{...}}` tokens may be substituted.
   *
   * Everything the harness itself assembles — system prompt, injected blocks,
   * user and assistant turns — is fair game, so a user who writes `{{time}}`
   * still gets a live clock. Tool results are not: they are records, and only
   * the activation tools listed in {@link HYDRATED_TOOL_RESULTS} return a
   * template that still needs hydrating.
   *
   * `foldedToolResult` covers the results a role conversion has already moved
   * out of `role: 'tool'` — in a group conversation another agent's results
   * arrive as `role: 'user'`, and they are no less a record for it.
   */
  private shouldHydrate(message: any): boolean {
    if (message?.role !== 'tool' && !message?.foldedToolResult) return true;

    const { apiName, identifier } = resolveToolIdentity(message);
    if (!identifier || !apiName) return false;

    const allowlist = this.config.hydratedToolResults ?? HYDRATED_TOOL_RESULTS;
    return allowlist[identifier]?.includes(apiName) ?? false;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    const depth = this.config.depth ?? 2;
    const generators = this.config.variableGenerators;

    // Defensive: guard against a malformed config that reached runtime despite
    // the TypeScript contract.  A missing generator map is a harness bug, not a
    // user error — throw early with an actionable message.
    if (!generators || typeof generators !== 'object') {
      throw new Error(
        'PlaceholderVariablesProcessor: variableGenerators config is missing or invalid. ' +
          `Received: ${JSON.stringify(generators)}`,
      );
    }

    const generatorKeys = Object.keys(generators);
    log(`Starting placeholder variables processing with ${generatorKeys.length} generators`);
    log('Generator keys: %o', generatorKeys);

    // Collect per-message failures so the caller can see which message(s) failed
    // and with what placeholder(s), even when the processor recovers and continues.
    const failures: Array<{
      error: string;
      messageId?: string;
      messageIndex: number;
      messageRole?: string;
      contentPreview: string;
      unresolvedPlaceholders?: string[];
    }> = [];

    // Process placeholder variables for each message
    for (let i = 0; i < clonedContext.messages.length; i++) {
      const message = clonedContext.messages[i];

      // A tool result outside the hydration allowlist is a verbatim record of
      // what the tool returned — never rewrite it. See HYDRATED_TOOL_RESULTS.
      if (!this.shouldHydrate(message)) {
        log('Skipping non-hydrated tool result at %d (name=%s)', i, message.name);
        continue;
      }

      const contentPreview = buildContentPreview(message.content);

      log(
        'Processing message %d: role=%s, contentType=%s, contentPreview=%s',
        i,
        message.role,
        typeof message.content,
        contentPreview,
      );

      try {
        const { processed, unresolvedPlaceholders } =
          this.processMessagePlaceholdersWithDiagnostics(message, depth);

        if (JSON.stringify(processed) !== JSON.stringify(message)) {
          clonedContext.messages[i] = processed;
          processedCount++;
          log(`Processed placeholders in message ${message.id}, role: ${message.role}`);
        } else {
          log(`No placeholders found/replaced in message ${message.id}, role: ${message.role}`);
        }

        // Even when processing "succeeded", track unresolvable placeholders
        // so the dashboard can alert on probable user typos.
        if (unresolvedPlaceholders && unresolvedPlaceholders.length > 0) {
          log(
            'Unresolved placeholders in message %d (role=%s): %o',
            i,
            message.role,
            unresolvedPlaceholders,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Extract unresolved placeholder names from the message content for diagnostics
        const unresolvedPlaceholders = extractUnresolvedPlaceholderNames(message, generatorKeys);

        failures.push({
          contentPreview,
          error: errorMessage,
          messageId: message.id,
          messageIndex: i,
          messageRole: message.role,
          unresolvedPlaceholders,
        });

        log.extend('error')(
          `Error processing placeholders in message %d (id=%s, role=%s, unresolved=%o): %s`,
          i,
          message.id,
          message.role,
          unresolvedPlaceholders,
          errorMessage,
        );
        // Continue processing other messages
      }
    }

    // Update metadata
    clonedContext.metadata.placeholderVariablesProcessed = processedCount;

    // Attach failure diagnostics to metadata so the dashboard can surface them
    // without requiring debug-level logging.
    if (failures.length > 0) {
      (clonedContext.metadata as any).placeholderVariablesFailures = failures;
    }

    log(`Placeholder variables processing completed, processed ${processedCount} messages`);

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Process placeholder variables for a single message, returning both the
   * processed message and the list of placeholder names that could not be resolved.
   *
   * Unresolved placeholders are placeholders whose key exists in the message
   * but has no matching generator.  They are likely user typos (e.g.
   * `{{nickname}}` misspelled as `{{nickName}}`) or a missing generator config.
   */
  private processMessagePlaceholdersWithDiagnostics(
    message: any,
    depth: number,
  ): { processed: any; unresolvedPlaceholders: string[] } {
    if (!message?.content) return { processed: message, unresolvedPlaceholders: [] };

    const { content } = message;
    const generatorKeys = Object.keys(this.config.variableGenerators);
    const generatorSet = new Set(generatorKeys);

    // Helper to collect unresolved placeholder names from a text
    const collectUnresolvedFromText = (text: string): string[] => {
      const tokens = extractPlaceholderTokens(text);
      return tokens.filter((t) => !generatorSet.has(t.key)).map((t) => t.key);
    };

    if (typeof content === 'string') {
      const unresolved = collectUnresolvedFromText(content);
      return {
        processed: {
          ...message,
          content: parsePlaceholderVariables(content, this.config.variableGenerators, depth),
        },
        unresolvedPlaceholders: [...new Set(unresolved)],
      };
    }

    if (Array.isArray(content)) {
      const allUnresolved: string[] = [];
      return {
        processed: {
          ...message,
          content: content.map((item) => {
            if (item?.type === 'text' && typeof item.text === 'string') {
              const unresolved = collectUnresolvedFromText(item.text);
              allUnresolved.push(...unresolved);
              return {
                ...item,
                text: parsePlaceholderVariables(item.text, this.config.variableGenerators, depth),
              };
            }
            return item;
          }),
        },
        unresolvedPlaceholders: [...new Set(allUnresolved)],
      };
    }

    return { processed: message, unresolvedPlaceholders: [] };
  }
}
