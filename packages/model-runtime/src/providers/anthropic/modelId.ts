export type ClaudeModelIdSource = 'anthropic' | 'bedrock' | 'openRouter';
export type ClaudeModelVersionSeparator = '-' | '.';

export interface ParsedClaudeModelId {
  family: string;
  majorVersion: number;
  minorSeparator?: ClaudeModelVersionSeparator;
  minorVersion?: number;
  normalizedModelId: string;
  source: ClaudeModelIdSource;
}

interface ExtractedClaudeModelId {
  normalizedModelId: string;
  source: ClaudeModelIdSource;
}

const CLAUDE_FAMILY_FIRST_PATTERN = /^claude-([a-z][a-z0-9]*)-(\d+)(?:([-.])(\d+))?(?:\b|[-.:])/;
const CLAUDE_VERSION_FIRST_PATTERN = /^claude-(\d+)(?:([-.])(\d+))?-([a-z][a-z0-9]*)(?:\b|[-.:])/;

const extractClaudeModelId = (model: string): ExtractedClaudeModelId | undefined => {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return;

  if (normalized.startsWith('anthropic/')) {
    return { normalizedModelId: normalized.slice('anthropic/'.length), source: 'openRouter' };
  }

  const bedrockPrefixIndex = normalized.lastIndexOf('anthropic.');
  if (bedrockPrefixIndex >= 0) {
    return {
      normalizedModelId: normalized.slice(bedrockPrefixIndex + 'anthropic.'.length),
      source: 'bedrock',
    };
  }

  if (normalized.startsWith('claude-')) {
    return { normalizedModelId: normalized, source: 'anthropic' };
  }
};

const parseMinorVersion = (
  value: string | undefined,
  separator: string | undefined,
): Pick<ParsedClaudeModelId, 'minorSeparator' | 'minorVersion'> => {
  if (!value || !separator || !/^\d{1,2}$/.test(value)) return {};

  return {
    minorSeparator: separator as ClaudeModelVersionSeparator,
    minorVersion: Number(value),
  };
};

export const parseClaudeModelId = (model: string): ParsedClaudeModelId | undefined => {
  const extracted = extractClaudeModelId(model);
  if (!extracted) return;

  const familyFirstMatch = CLAUDE_FAMILY_FIRST_PATTERN.exec(extracted.normalizedModelId);
  if (familyFirstMatch) {
    const [, family, majorVersion, minorSeparator, minorVersion] = familyFirstMatch;

    return {
      family,
      majorVersion: Number(majorVersion),
      normalizedModelId: extracted.normalizedModelId,
      source: extracted.source,
      ...parseMinorVersion(minorVersion, minorSeparator),
    };
  }

  const versionFirstMatch = CLAUDE_VERSION_FIRST_PATTERN.exec(extracted.normalizedModelId);
  if (versionFirstMatch) {
    const [, majorVersion, minorSeparator, minorVersion, family] = versionFirstMatch;

    return {
      family,
      majorVersion: Number(majorVersion),
      normalizedModelId: extracted.normalizedModelId,
      source: extracted.source,
      ...parseMinorVersion(minorVersion, minorSeparator),
    };
  }
};

const hasMinorVersionAtLeast = (parsed: ParsedClaudeModelId, minorVersion: number): boolean =>
  parsed.minorVersion !== undefined && parsed.minorVersion >= minorVersion;

const isClaudeFamily = (parsed: ParsedClaudeModelId, families: readonly string[]): boolean =>
  families.includes(parsed.family);

export const isContextCachingModel = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion >= 5) return true;

  if (parsed.majorVersion === 4) {
    return (
      isClaudeFamily(parsed, ['opus', 'sonnet']) ||
      (parsed.family === 'haiku' && hasMinorVersionAtLeast(parsed, 5))
    );
  }

  if (parsed.majorVersion === 3) {
    return (
      (parsed.family === 'sonnet' && hasMinorVersionAtLeast(parsed, 7)) ||
      (isClaudeFamily(parsed, ['sonnet', 'haiku']) && parsed.minorVersion === 5)
    );
  }

  return false;
};

export const isThinkingWithToolClaudeModel = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion >= 5) return true;

  if (parsed.majorVersion === 4) {
    return (
      isClaudeFamily(parsed, ['opus', 'sonnet']) ||
      (parsed.family === 'haiku' && hasMinorVersionAtLeast(parsed, 5))
    );
  }

  return (
    parsed.majorVersion === 3 && parsed.family === 'sonnet' && hasMinorVersionAtLeast(parsed, 7)
  );
};

/**
 * Claude 5 and later think by default — omitting `thinking` runs adaptive, whereas on
 * Opus 4.8 / 4.7 omitting it meant no thinking. Callers mirror this in the UI so a fresh
 * config doesn't silently disable thinking on models that ship it on.
 * @see https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
 */
export const isAdaptiveThinkingDefaultOnModel = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  return !!parsed && parsed.majorVersion >= 5;
};

/**
 * Thinking cannot be turned off on these models — `thinking: {type: 'disabled'}` returns a 400.
 * Callers should omit the thinking config instead; `display` is the way to hide reasoning text.
 * @see https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting#supported-models
 */
export const isAlwaysThinkingClaudeModel = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  if (!parsed) return false;

  // Claude Fable 5 and Claude Mythos 5 (and Claude Mythos Preview) always think.
  return isClaudeFamily(parsed, ['fable', 'mythos']) && parsed.majorVersion >= 5;
};

/**
 * `thinking.display` defaults to `omitted` on these models, so reasoning comes back as thinking
 * blocks with an empty `thinking` field (streaming emits no `thinking_delta`). Anything that
 * surfaces reasoning to users has to opt into `display: 'summarized'` explicitly.
 * @see https://platform.claude.com/docs/en/build-with-claude/thinking#controlling-thinking-display
 */
export const isThinkingDisplayOmittedByDefaultModel = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  if (!parsed) return false;

  if (parsed.majorVersion >= 5) return true;

  // Claude Opus 4.8 / 4.7; Opus 4.6 and earlier still default to `summarized`.
  return parsed.family === 'opus' && parsed.majorVersion === 4 && hasMinorVersionAtLeast(parsed, 7);
};

const EFFORTS_INCOMPATIBLE_WITH_DISABLED_THINKING = new Set(['xhigh', 'max']);

/**
 * Claude Opus 5 and later reject `thinking: {type: 'disabled'}` combined with effort `xhigh` or
 * `max`. Every lower effort level stays valid alongside disabled thinking, so callers should drop
 * `effort` only for this specific pairing.
 * @see https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting#supported-models
 */
export const rejectsDisabledThinkingAtEffort = (model: string, effort: string): boolean => {
  const parsed = parseClaudeModelId(model);

  return (
    !!parsed && parsed.majorVersion >= 5 && EFFORTS_INCOMPATIBLE_WITH_DISABLED_THINKING.has(effort)
  );
};

export const hasTemperatureTopPConflict = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  return !!parsed && parsed.majorVersion >= 4;
};

export const shouldOmitSamplingParams = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  if (!parsed) return false;
  if (parsed.majorVersion >= 5) return true;
  if (parsed.family !== 'opus' || parsed.majorVersion !== 4) return false;
  if (parsed.minorVersion !== 7 && parsed.minorVersion !== 8) return false;

  return parsed.source !== 'openRouter' || parsed.minorSeparator === '.';
};

export const shouldDropUnsupportedClaudeAssistantPrefill = (model: string): boolean => {
  const parsed = parseClaudeModelId(model);
  if (!parsed || parsed.source === 'openRouter') return false;
  if (parsed.majorVersion >= 5) return true;

  return (
    parsed.majorVersion === 4 &&
    isClaudeFamily(parsed, ['opus', 'sonnet']) &&
    parsed.minorVersion !== undefined &&
    parsed.minorVersion >= 6 &&
    parsed.minorVersion <= 8
  );
};
