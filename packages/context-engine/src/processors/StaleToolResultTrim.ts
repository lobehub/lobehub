import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    staleToolResultTrim?: {
      byRule: Record<string, number>;
      /** Whether the turn boundary fell inside the provider cache TTL. */
      cacheWarm?: boolean;
      /** Estimated gain used by the warm break-even check (skip path only). */
      gainEstimate?: number;
      /** Measured gap between the previous turn's last activity and the trigger. */
      gapMs?: number;
      /** What the trim would have saved (skip path only). */
      potentialSavedChars?: number;
      /** Estimated rewrite cost used by the warm break-even check (skip path only). */
      rewriteCostEstimate?: number;
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
   * Defaults to the active provider's policy from `economics`.
   */
  cacheReadPrice?: number;
  /**
   * Provider prompt-cache TTL in ms. A turn whose trigger follows the
   * previous turn's last activity within this window has a warm cache, so
   * trimming is a paid rewrite and goes through the warm break-even check.
   * Defaults to the active provider's policy from `economics`.
   */
  cacheTtlMs?: number;
  /**
   * Cache write price relative to the plain input price.
   * Defaults to the active provider's policy from `economics`.
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
   * Cache economics of the active provider (TTL + read/write prices), e.g.
   * from {@link cacheEconomicsForProvider}. Individual `cache*` overrides win.
   * @default ANTHROPIC_CACHE_ECONOMICS
   */
  economics?: CacheEconomics;
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

export interface CacheEconomics {
  /** Cached-read price relative to the plain input price. */
  readPrice: number;
  /** Cache entry lifetime in ms; a turn gap beyond this means the cache is cold. */
  ttlMs: number;
  /** Reprocessing price of an invalidated prefix, relative to plain input. */
  writePrice: number;
}

export const ANTHROPIC_CACHE_ECONOMICS: CacheEconomics = {
  readPrice: 0.1, // cache read = 10% of input
  ttlMs: 300_000, // 5-minute ephemeral TTL, refreshed per hit
  writePrice: 1.25, // cache write = 1.25× input
};

// Cache economics differ per provider; pricing the warmth verdict and the
// break-even gate with the wrong ones either rewrites still-warm prefixes or
// skips worthwhile trims.
const PROVIDER_CACHE_ECONOMICS: Record<string, CacheEconomics> = {
  anthropic: ANTHROPIC_CACHE_ECONOMICS,
  // Anthropic models via Bedrock share the same cache semantics.
  bedrock: ANTHROPIC_CACHE_ECONOMICS,
  deepseek: {
    // Automatic disk context cache: long-lived, hit ≈ 0.25× miss, no write
    // fee — an invalidated prefix just costs a plain input pass.
    readPrice: 0.25,
    ttlMs: 3_600_000,
    writePrice: 1,
  },
  google: {
    // Gemini implicit caching: short TTL, hit ≈ 0.25×, no explicit write fee.
    readPrice: 0.25,
    ttlMs: 300_000,
    writePrice: 1,
  },
  openai: {
    // Automatic prompt caching: short inactivity expiry, hit = 0.5×, no write fee.
    readPrice: 0.5,
    ttlMs: 300_000,
    writePrice: 1,
  },
};

/** Cache economics for a provider id; falls back to Anthropic's (most conservative TTL). */
export const cacheEconomicsForProvider = (provider?: string): CacheEconomics =>
  PROVIDER_CACHE_ECONOMICS[provider ?? ''] ?? ANTHROPIC_CACHE_ECONOMICS;

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
 * The window a readFile call actually returned. An omitted `loc` defaults to
 * the first 200 lines in the service (`readLocalFile` slices `loc ?? [0, 200]`)
 * unless `fullContent` was requested — treating it as an unbounded full-file
 * read would let a later default read claim to cover ranges it never returned.
 */
const effectiveReadWindow = (
  message: Message,
  plugin: PluginInfo | undefined,
): [number, number] => {
  const explicit = locOf(message, plugin);
  if (explicit) return explicit;
  return parseArguments(plugin?.arguments)?.fullContent
    ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
    : [0, 200];
};

/**
 * `UIChatMessage.createdAt` is an epoch-milliseconds number on the canonical
 * path; DB dumps and tests carry ISO strings. `Date.parse(number)` coerces to
 * a garbage string and yields NaN, so normalize explicitly.
 */
const toEpochMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
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
    const economics = config.economics ?? ANTHROPIC_CACHE_ECONOMICS;
    this.config = {
      cacheReadPrice: config.cacheReadPrice ?? economics.readPrice,
      cacheTtlMs: config.cacheTtlMs ?? economics.ttlMs,
      cacheWritePrice: config.cacheWritePrice ?? economics.writePrice,
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

    // Turn boundary: the last user message starts the in-flight turn. Every
    // LLM step of a running operation re-assembles the payload and re-runs
    // this pipeline, so the trim set must be FROZEN for the whole turn —
    // anything that changes it mid-operation rewrites the prefix and colds
    // the warm prompt cache for every remaining step. Three moving parts are
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
    // 3. The minimum-size gate is measured on the closed history only:
    //    counting in-flight tool output would let the gate trip mid-turn as
    //    the op appends results, activating trims that were off at the
    //    boundary.
    //
    // When no user message exists (tests, exotic flows), the recency window
    // alone applies.
    const lastUserIndex = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
    const boundary =
      lastUserIndex >= 0
        ? Math.max(0, lastUserIndex + 1 - this.config.keepRecentMessages)
        : Math.max(0, messages.length - this.config.keepRecentMessages);

    let closedToolChars = 0;
    for (let i = 0; i < boundary; i++) {
      const m = messages[i];
      if (m.role === 'tool' && typeof m.content === 'string') closedToolChars += m.content.length;
    }
    if (closedToolChars < this.config.minTotalToolChars) {
      return this.markAsExecuted(context);
    }

    // Pass 1 — index events inside the closed history that invalidate earlier
    // results:
    // - writes per file path (any writeFile/editFile result row marks a write)
    // - read windows per path, to find reads fully covered by a later re-read
    // Failed results index nothing: a failed write did not supersede anything,
    // a failed read covers nothing.
    const lastWriteIndexByPath = new Map<string, number>();
    const readWindowsByPath = new Map<string, { end: number; index: number; start: number }[]>();

    for (let index = 0; index < boundary; index++) {
      const m = messages[index];
      if (m.role !== 'tool') continue;
      if (m.pluginError) continue;
      const plugin = getPlugin(m);
      if (plugin?.identifier !== LOCAL_SYSTEM) continue;

      const path = pathOf(m, plugin);
      if (!path) continue;

      if (WRITE_APIS.has(plugin.apiName ?? '')) {
        lastWriteIndexByPath.set(path, index);
      } else if (READ_APIS.has(plugin.apiName ?? '')) {
        const loc = effectiveReadWindow(m, plugin);
        const windows = readWindowsByPath.get(path) ?? [];
        windows.push({ end: loc[1], index, start: loc[0] });
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
    // would never recoup it, which is exactly what the check blocks. The gap,
    // the candidates, and the priced payload are all frozen at the turn
    // boundary, so the decision cannot flip mid-operation and flip the
    // prefix with it.
    const potentialSavedChars = candidates.reduce(
      (s, c) => s + (messages[c.index].content as string).length - c.content.length,
      0,
    );
    const triggeredAt = toEpochMs(messages[lastUserIndex]?.createdAt);
    const prevActivityAt = toEpochMs(messages[lastUserIndex - 1]?.createdAt);
    const gapMs =
      triggeredAt !== undefined && prevActivityAt !== undefined
        ? triggeredAt - prevActivityAt
        : undefined;
    const cacheWarm = gapMs !== undefined && gapMs <= this.config.cacheTtlMs;

    if (cacheWarm) {
      // The cost side of the break-even must be priced from the payload frozen
      // at the turn boundary (closed history + the trigger), not the live
      // message list: candidates and savings are already frozen there, and
      // counting in-flight output would grow the estimated rewrite cost
      // step by step, flipping a trim that passed the gate back to a skip
      // mid-operation and restoring the original prefix.
      const payloadEnd = lastUserIndex >= 0 ? lastUserIndex + 1 : messages.length;
      let totalChars = 0;
      for (let i = 0; i < payloadEnd; i++) {
        const m = messages[i];
        if (typeof m.content === 'string') totalChars += m.content.length;
      }
      const gainEstimate =
        this.config.warmRemainingStepsEstimate * potentialSavedChars * this.config.cacheReadPrice;
      const rewriteCostEstimate =
        (totalChars - potentialSavedChars) * this.config.cacheWritePrice -
        totalChars * this.config.cacheReadPrice;
      const worthwhile = gainEstimate > rewriteCostEstimate * this.config.warmSafetyMargin;
      if (!worthwhile) {
        log(
          'Skipping trim: cache warm (gap <= %dms), gain %d <= cost %d × %d',
          this.config.cacheTtlMs,
          gainEstimate,
          rewriteCostEstimate,
          this.config.warmSafetyMargin,
        );
        const skipped = this.cloneContext(context);
        skipped.metadata.staleToolResultTrim = {
          byRule: {},
          cacheWarm,
          gapMs,
          gainEstimate,
          potentialSavedChars,
          rewriteCostEstimate,
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

    clonedContext.metadata.staleToolResultTrim = {
      byRule,
      cacheWarm,
      gapMs,
      savedChars,
      trimmedMessages,
    };
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

      const loc = effectiveReadWindow(message, plugin);
      const covered = (readWindowsByPath.get(path) ?? []).some(
        (w) => w.index > index && w.start <= loc[0] && w.end >= loc[1],
      );
      if (covered) {
        return {
          content: `[readFile result trimmed: ${path} (lines ${loc[0]}-${loc[1]}) — the same range was read again later. Refer to the newer read, or call readFile again if needed.]`,
          rule: 'readSupersededByRead',
        };
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
