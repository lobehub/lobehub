import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    staleToolResultTrim?: {
      byRule: Record<string, number>;
      savedChars: number;
      skippedReason?: 'warm-cache';
      trimmedMessages: number;
    };
  }
}

const log = debug('context-engine:processor:StaleToolResultTrimProcessor');

export interface StaleToolResultTrimConfig {
  /**
   * Cache read price relative to the plain input price.
   * Anthropic: 0.1.
   * @default 0.1
   */
  cacheReadPrice?: number;
  /**
   * Provider prompt-cache TTL in ms. A turn whose trigger follows the
   * previous turn's last activity within this window has a warm cache, so
   * trimming is a paid rewrite and goes through the warm break-even check.
   * Anthropic: 5 min (refreshed per hit).
   * @default 300_000
   */
  cacheTtlMs?: number;
  /**
   * Cache write price relative to the plain input price.
   * Anthropic 5-min TTL: 1.25.
   * @default 1.25
   */
  cacheWritePrice?: number;
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
  /**
   * Warm-cache break-even: assumed number of remaining LLM steps the current
   * turn will run. The trim fires on a warm cache only when
   * `estimate × saved × readPrice > rewriteDelta × warmSafetyMargin`.
   * Conservative default; real heavy ops run 100+ steps, quick follow-ups 1-5.
   * @default 20
   */
  warmRemainingStepsEstimate?: number;
  /**
   * Multiplier on the rewrite cost in the warm break-even check, absorbing
   * estimation error.
   * @default 1.5
   */
  warmSafetyMargin?: number;
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
  arguments?: unknown;
  identifier?: string;
}

const getPlugin = (message: Message): PluginInfo | undefined =>
  message.plugin as PluginInfo | undefined;

// On the wire, `plugin.arguments` is the serialized JSON string from the
// model's tool call; older rows and tests may carry the parsed object.
const parseArguments = (args: unknown): Record<string, any> | undefined => {
  if (!args) return undefined;
  if (typeof args === 'object') return args as Record<string, any>;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

// Prefer the structured pluginState (`ReadFileState`/`WriteFileState` carry
// `path`/`loc` as real fields); fall back to parsing the tool-call arguments
// for rows written before the state fields existed.
const pathOf = (message: Message, plugin: PluginInfo | undefined): string | undefined => {
  const fromState = (message.pluginState as { path?: unknown } | undefined)?.path;
  if (typeof fromState === 'string' && fromState.length > 0) return fromState;
  const args = parseArguments(plugin?.arguments);
  const p = args?.path ?? args?.file_path;
  return typeof p === 'string' && p.length > 0 ? p : undefined;
};

const locOf = (message: Message, plugin: PluginInfo | undefined): [number, number] | undefined => {
  const fromState = (message.pluginState as { loc?: unknown } | undefined)?.loc;
  if (Array.isArray(fromState) && fromState.length === 2) {
    return [fromState[0], fromState[1]];
  }
  const loc = parseArguments(plugin?.arguments)?.loc;
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
 * Cache safety comes from three constraints: trim decisions only depend on
 * the presence of LATER messages, so once trimmed a message trims identically
 * on every later request and the already-trimmed prefix stays byte-stable;
 * the trim never touches messages from the in-flight turn (after the last
 * user message), because every LLM step of a running operation re-runs this
 * pipeline and rewriting the prefix mid-operation would cold the warm prompt
 * cache for every remaining step; and when the turn boundary itself has a
 * warm cache (user followed up within the provider's cache TTL), the trim is
 * a paid rewrite, so it only fires when the savings clear the warm
 * thresholds. Trimming is truly free at cold boundaries — the first turn,
 * or any gap longer than the cache TTL.
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
      cacheReadPrice: config.cacheReadPrice ?? 0.1,
      cacheTtlMs: config.cacheTtlMs ?? 300_000,
      cacheWritePrice: config.cacheWritePrice ?? 1.25,
      commandKeepChars: config.commandKeepChars ?? 500,
      crawlKeepChars: config.crawlKeepChars ?? 1000,
      enabled: config.enabled ?? true,
      keepRecentMessages: config.keepRecentMessages ?? 20,
      minTotalToolChars: config.minTotalToolChars ?? 100_000,
      warmRemainingStepsEstimate: config.warmRemainingStepsEstimate ?? 20,
      warmSafetyMargin: config.warmSafetyMargin ?? 1.5,
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

    // Turn boundary: the last user message starts the in-flight turn. Every
    // LLM step of a running operation re-assembles the payload and re-runs
    // this pipeline, so the trim set must be FROZEN for the whole turn —
    // anything that changes it mid-operation rewrites the prefix and colds
    // the warm prompt cache for every remaining step. Two moving parts are
    // pinned accordingly:
    //
    // 1. The recency window is derived from the turn boundary, not the
    //    growing message count: the protected tail is the K messages before
    //    the trigger plus the entire in-flight turn. `messages.length - K`
    //    would advance as the op appends, letting old results cross the
    //    cutoff mid-operation.
    // 2. The supersede index (pass 1) only covers the closed history before
    //    the boundary: an in-flight write must not retroactively trim
    //    pre-boundary reads mid-operation. It takes effect at the next turn
    //    boundary instead.
    //
    // When no user message exists (tests, exotic flows), the recency window
    // alone applies.
    const lastUserIndex = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
    const boundary =
      lastUserIndex >= 0
        ? Math.max(0, lastUserIndex + 1 - this.config.keepRecentMessages)
        : Math.max(0, messages.length - this.config.keepRecentMessages);

    // Pass 1 — index events inside the closed history that invalidate earlier
    // results:
    // - writes per file path (any writeFile/editFile result row marks a write)
    // - read windows per path, to find reads fully covered by a later re-read
    const lastWriteIndexByPath = new Map<string, number>();
    const readWindowsByPath = new Map<string, { end: number; index: number; start: number }[]>();

    for (let index = 0; index < boundary; index++) {
      const m = messages[index];
      if (m.role !== 'tool') continue;
      const plugin = getPlugin(m);
      if (plugin?.identifier !== LOCAL_SYSTEM) continue;

      const path = pathOf(m, plugin);
      if (!path) continue;

      if (WRITE_APIS.has(plugin.apiName ?? '')) {
        lastWriteIndexByPath.set(path, index);
      } else if (READ_APIS.has(plugin.apiName ?? '')) {
        const loc = locOf(m, plugin);
        const windows = readWindowsByPath.get(path) ?? [];
        windows.push(
          loc
            ? { end: loc[1], index, start: loc[0] }
            : // A full-file read covers every earlier window of the same file
              { end: Number.POSITIVE_INFINITY, index, start: Number.NEGATIVE_INFINITY },
        );
        readWindowsByPath.set(path, windows);
      }
    }

    // Pass 2 — collect trim candidates (dry run first; the cache-warmth gate
    // below needs the total savings before deciding).
    const candidates: { content: string; index: number; rule: string }[] = [];
    for (let index = 0; index < boundary; index++) {
      const message = messages[index];
      if (message.role !== 'tool') continue;
      if (typeof message.content !== 'string' || message.content.length === 0) continue;
      // Error results are the most valuable debugging context — never trim.
      if (message.pluginError) continue;

      const trimmed = this.trimMessage(message, index, lastWriteIndexByPath, readWindowsByPath);
      if (trimmed === undefined || trimmed.content === message.content) continue;
      candidates.push({ content: trimmed.content, index, rule: trimmed.rule });
    }

    if (candidates.length === 0) {
      return this.markAsExecuted(context);
    }

    // Cache-warmth gate. Trimming is free only when the prompt cache is cold —
    // i.e. the gap between the previous turn's last activity and this turn's
    // trigger exceeds the provider's cache TTL (Anthropic: 5 min, refreshed
    // per hit). When the user follows up within the TTL, the untrimmed prefix
    // would still hit, so the trim must clear a break-even check against the
    // rewrite it causes:
    //
    //   gain = R_est × S × readPrice   (each remaining step reads S less)
    //   cost = ((P − S) × writePrice − P × readPrice) × margin
    //
    // Thanks to determinism the rewrite is paid at most once per trim-set
    // change, not per follow-up — but a warm quick-question turn (1-5 steps)
    // would never recoup it, which is exactly what the check blocks. Both
    // timestamps are fixed for the whole turn, so the decision cannot flip
    // mid-operation and flip the prefix with it.
    const potentialSavedChars = candidates.reduce(
      (s, c) => s + (messages[c.index].content as string).length - c.content.length,
      0,
    );
    const triggeredAt = Date.parse(messages[lastUserIndex]?.createdAt ?? '');
    const prevActivityAt = Date.parse(messages[lastUserIndex - 1]?.createdAt ?? '');
    const cacheWarm =
      Number.isFinite(triggeredAt) &&
      Number.isFinite(prevActivityAt) &&
      triggeredAt - prevActivityAt <= this.config.cacheTtlMs;

    if (cacheWarm) {
      const totalChars = messages.reduce(
        (s, m) => s + (typeof m.content === 'string' ? m.content.length : 0),
        0,
      );
      const gain =
        this.config.warmRemainingStepsEstimate * potentialSavedChars * this.config.cacheReadPrice;
      const rewriteDelta =
        (totalChars - potentialSavedChars) * this.config.cacheWritePrice -
        totalChars * this.config.cacheReadPrice;
      const worthwhile = gain > rewriteDelta * this.config.warmSafetyMargin;
      if (!worthwhile) {
        log(
          'Skipping trim: cache warm (gap <= %dms), gain %d <= cost %d × %d',
          this.config.cacheTtlMs,
          gain,
          rewriteDelta,
          this.config.warmSafetyMargin,
        );
        const skipped = this.cloneContext(context);
        skipped.metadata.staleToolResultTrim = {
          byRule: {},
          savedChars: 0,
          skippedReason: 'warm-cache',
          trimmedMessages: 0,
        };
        return this.markAsExecuted(skipped);
      }
    }

    // Pass 3 — apply
    const clonedContext = this.cloneContext(context);
    let savedChars = 0;
    const byRule: Record<string, number> = {};
    const candidateByIndex = new Map(candidates.map((c) => [c.index, c]));

    clonedContext.messages = clonedContext.messages.map((message, index) => {
      const candidate = candidateByIndex.get(index);
      if (!candidate) return message;

      savedChars += (message.content as string).length - candidate.content.length;
      byRule[candidate.rule] = (byRule[candidate.rule] ?? 0) + 1;
      return { ...message, content: candidate.content };
    });

    const trimmedMessages = candidates.length;

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
      const path = pathOf(message, plugin);
      if (!path) return undefined;

      const writeIndex = lastWriteIndexByPath.get(path);
      if (writeIndex !== undefined && writeIndex > index) {
        return {
          content: `[readFile result trimmed: ${path} — superseded by a later write to this file. Call readFile again if you need the current content.]`,
          rule: 'readSupersededByWrite',
        };
      }

      const loc = locOf(message, plugin);
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
