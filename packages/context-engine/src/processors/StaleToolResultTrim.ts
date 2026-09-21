import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    staleToolResultTrim?: {
      byRule: Record<string, number>;
      savedChars: number;
      trimmedMessages: number;
    };
  }
}

const log = debug('context-engine:processor:StaleToolResultTrimProcessor');

export interface StaleToolResultTrimConfig {
  /**
   * Head chars kept when an old `runCommand` / `getCommandOutput` result is
   * trimmed (the same number of tail chars is also kept).
   * @default 500
   */
  commandKeepChars?: number;
  /**
   * Head chars kept when an old web-browsing search/crawl result is trimmed.
   * @default 1000
   */
  crawlKeepChars?: number;
  /**
   * Master switch.
   * @default true
   */
  enabled?: boolean;
  /**
   * Trailing message count that is never trimmed. The model is actively
   * working with the tail of the conversation; trimming there saves little and
   * risks evicting context it is about to use.
   * @default 20
   */
  keepRecentMessages?: number;
  /**
   * Total chars of tool results below which the trim is skipped entirely —
   * small conversations gain nothing and the gate keeps the no-op path cheap.
   * Monotone within a growing history, so it cannot flip the prefix back and
   * forth between requests.
   * @default 100_000
   */
  minTotalToolChars?: number;
}

const LOCAL_SYSTEM = 'lobe-local-system';
const BROWSER = 'lobe-browser';
const WEB_BROWSING = 'lobe-web-browsing';

const READ_APIS = new Set(['readFile']);
const WRITE_APIS = new Set(['writeFile', 'editFile']);
const COMMAND_APIS = new Set(['runCommand', 'getCommandOutput']);
const BROWSER_PAGE_APIS = new Set(['snapshot', 'readPage']);
const CRAWL_APIS = new Set(['search', 'crawlSinglePage', 'crawlMultiPages']);

interface PluginInfo {
  apiName?: string;
  arguments?: Record<string, any>;
  identifier?: string;
}

const getPlugin = (message: Message): PluginInfo | undefined =>
  message.plugin as PluginInfo | undefined;

const pathOf = (plugin: PluginInfo | undefined): string | undefined => {
  const p = plugin?.arguments?.path ?? plugin?.arguments?.file_path;
  return typeof p === 'string' && p.length > 0 ? p : undefined;
};

const locOf = (plugin: PluginInfo | undefined): [number, number] | undefined => {
  const loc = plugin?.arguments?.loc;
  return Array.isArray(loc) && loc.length === 2 ? [loc[0], loc[1]] : undefined;
};

/**
 * Replaces the bodies of stale tool results with short placeholders at the
 * payload-assembly boundary.
 *
 * Motivation: within one topic, every request replays the full history, and
 * tool results dominate that history (a single readFile of a large file is
 * tens of KB). Once a result is superseded — the file was rewritten since,
 * the page snapshot is ten interactions old — replaying it buys the model
 * nothing, but every caller still pays for it on every step.
 *
 * Cache safety: the trim runs on the loaded history on every request and the
 * rules are monotone — a message, once trimmed, trims identically on every
 * later request (trim decisions only depend on the presence of LATER
 * messages, never on earlier ones, and the recency window only moves
 * forward). The already-trimmed prefix therefore stays byte-stable across
 * requests and keeps the prompt-cache prefix reusable; the savings land at
 * the operation boundary, where the cache is cold anyway (TTL) and the whole
 * prefix would be rewritten regardless.
 *
 * Must run AFTER the flatten processors (assistantGroup / compressedGroup
 * hoist nested tool results into top-level `role: 'tool'` rows with
 * plugin/pluginState re-attached) and BEFORE ToolCallProcessor.
 */
export class StaleToolResultTrimProcessor extends BaseProcessor {
  readonly name = 'StaleToolResultTrimProcessor';

  private config: Required<Omit<StaleToolResultTrimConfig, 'enabled'>> & { enabled: boolean };

  constructor(config: StaleToolResultTrimConfig = {}, options: ProcessorOptions = {}) {
    super(options);
    this.config = {
      commandKeepChars: config.commandKeepChars ?? 500,
      crawlKeepChars: config.crawlKeepChars ?? 1000,
      enabled: config.enabled ?? true,
      keepRecentMessages: config.keepRecentMessages ?? 20,
      minTotalToolChars: config.minTotalToolChars ?? 100_000,
    };
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled) return this.markAsExecuted(context);

    const messages = context.messages;

    const totalToolChars = messages.reduce(
      (sum, m) =>
        m.role === 'tool' && typeof m.content === 'string' ? sum + m.content.length : sum,
      0,
    );
    if (totalToolChars < this.config.minTotalToolChars) {
      return this.markAsExecuted(context);
    }

    // Pass 1 — index later events that invalidate earlier results:
    // - writes per file path (any writeFile/editFile result row marks a write)
    // - read windows per path, to find reads fully covered by a later re-read
    const lastWriteIndexByPath = new Map<string, number>();
    const readWindowsByPath = new Map<string, { end: number; index: number; start: number }[]>();

    messages.forEach((m, index) => {
      if (m.role !== 'tool') return;
      const plugin = getPlugin(m);
      if (plugin?.identifier !== LOCAL_SYSTEM) return;

      const path = pathOf(plugin);
      if (!path) return;

      if (WRITE_APIS.has(plugin.apiName ?? '')) {
        lastWriteIndexByPath.set(path, index);
      } else if (READ_APIS.has(plugin.apiName ?? '')) {
        const loc = locOf(plugin);
        const windows = readWindowsByPath.get(path) ?? [];
        windows.push(
          loc
            ? { end: loc[1], index, start: loc[0] }
            : // A full-file read covers every earlier window of the same file
              { end: Number.POSITIVE_INFINITY, index, start: Number.NEGATIVE_INFINITY },
        );
        readWindowsByPath.set(path, windows);
      }
    });

    // Pass 2 — trim
    const clonedContext = this.cloneContext(context);
    const keepFrom = messages.length - this.config.keepRecentMessages;

    // Turn boundary: the last user message starts the in-flight turn. Every
    // LLM step of a running operation re-assembles the payload and re-runs
    // this pipeline, so trimming a message produced DURING the current turn
    // would rewrite the prefix mid-operation and invalidate the warm prompt
    // cache for every remaining step. Restricting the trim to messages older
    // than the last user message confines it to the operation boundary, where
    // the cache is cold anyway. When no user message exists (tests, exotic
    // flows), the recency window alone applies.
    const lastUserIndex = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
    const boundary = lastUserIndex >= 0 ? Math.min(keepFrom, lastUserIndex) : keepFrom;

    let trimmedMessages = 0;
    let savedChars = 0;
    const byRule: Record<string, number> = {};

    clonedContext.messages = clonedContext.messages.map((message, index) => {
      if (index >= boundary) return message;
      if (message.role !== 'tool') return message;
      if (typeof message.content !== 'string' || message.content.length === 0) return message;
      // Error results are the most valuable debugging context — never trim.
      if (message.pluginError) return message;

      const trimmed = this.trimMessage(message, index, lastWriteIndexByPath, readWindowsByPath);
      if (trimmed === undefined || trimmed.content === message.content) return message;

      trimmedMessages += 1;
      savedChars += message.content.length - trimmed.content.length;
      byRule[trimmed.rule] = (byRule[trimmed.rule] ?? 0) + 1;
      return { ...message, content: trimmed.content };
    });

    if (trimmedMessages > 0) {
      log('Trimmed %d stale tool result(s), saved %d chars', trimmedMessages, savedChars);
    }

    clonedContext.metadata.staleToolResultTrim = { byRule, savedChars, trimmedMessages };
    return this.markAsExecuted(clonedContext);
  }

  /** Returns the replacement, or undefined when the message must stay untouched. */
  private trimMessage(
    message: Message,
    index: number,
    lastWriteIndexByPath: Map<string, number>,
    readWindowsByPath: Map<string, { end: number; index: number; start: number }[]>,
  ): { content: string; rule: string } | undefined {
    const plugin = getPlugin(message);
    const identifier = plugin?.identifier;
    const apiName = plugin?.apiName ?? '';
    const content = message.content as string;

    if (identifier === LOCAL_SYSTEM && READ_APIS.has(apiName)) {
      const path = pathOf(plugin);
      if (!path) return undefined;

      const writeIndex = lastWriteIndexByPath.get(path);
      if (writeIndex !== undefined && writeIndex > index) {
        return {
          content: `[readFile result trimmed: ${path} — superseded by a later write to this file. Call readFile again if you need the current content.]`,
          rule: 'readSupersededByWrite',
        };
      }

      const loc = locOf(plugin);
      if (loc) {
        const covered = (readWindowsByPath.get(path) ?? []).some(
          (w) => w.index > index && w.start <= loc[0] && w.end >= loc[1],
        );
        if (covered) {
          return {
            content: `[readFile result trimmed: ${path} (lines ${loc[0]}-${loc[1]}) — the same range was read again later. Refer to the newer read, or call readFile again if needed.]`,
            rule: 'readSupersededByRead',
          };
        }
      }
      return undefined;
    }

    if (identifier === BROWSER && BROWSER_PAGE_APIS.has(apiName)) {
      return {
        content: `[browser ${apiName} result trimmed — stale page state. Take a new snapshot if you need the current page.]`,
        rule: 'staleBrowserPage',
      };
    }

    if (identifier === WEB_BROWSING && CRAWL_APIS.has(apiName)) {
      if (content.length <= this.config.crawlKeepChars) return undefined;
      return {
        content: `${content.slice(0, this.config.crawlKeepChars)}\n[... trimmed ${content.length - this.config.crawlKeepChars} chars of stale web-browsing result. Search or crawl again if you need the full content.]`,
        rule: 'staleCrawlResult',
      };
    }

    if (
      identifier === LOCAL_SYSTEM &&
      COMMAND_APIS.has(apiName) &&
      content.length > this.config.commandKeepChars * 2
    ) {
      const head = content.slice(0, this.config.commandKeepChars);
      const tail = content.slice(-this.config.commandKeepChars);
      return {
        content: `${head}\n[... trimmed ${content.length - this.config.commandKeepChars * 2} chars of old command output ...]\n${tail}`,
        rule: 'oldCommandOutput',
      };
    }

    return undefined;
  }
}
