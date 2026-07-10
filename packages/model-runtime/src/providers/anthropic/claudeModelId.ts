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
