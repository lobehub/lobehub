export interface ParsedQwenModelId {
  family: string;
  majorVersion?: number;
  minorVersion?: number;
  normalizedModelId: string;
}

/**
 * Versioned commercial ids like `qwen3.8-max-preview`, `qwen3-vl-plus`.
 * The family must start with a letter, so open-source size segments
 * (`qwen3-235b-...`) intentionally do not parse as a family.
 */
const QWEN_VERSIONED_PATTERN = /^qwen(\d+)(?:\.(\d+))?-([a-z][a-z0-9]*)(?:\b|[-.:])/;

/** Version-less commercial ids like `qwen-max`, `qwen-plus-latest`. */
const QWEN_FAMILY_ONLY_PATTERN = /^qwen-([a-z][a-z0-9]*)(?:\b|[-.:])/;

export const parseQwenModelId = (model: string): ParsedQwenModelId | undefined => {
  const normalizedModelId = model.trim().toLowerCase();
  if (!normalizedModelId) return;

  const versionedMatch = QWEN_VERSIONED_PATTERN.exec(normalizedModelId);
  if (versionedMatch) {
    const [, majorVersion, minorVersion, family] = versionedMatch;

    return {
      family,
      majorVersion: Number(majorVersion),
      normalizedModelId,
      ...(minorVersion !== undefined && { minorVersion: Number(minorVersion) }),
    };
  }

  const familyOnlyMatch = QWEN_FAMILY_ONLY_PATTERN.exec(normalizedModelId);
  if (familyOnlyMatch) {
    const [, family] = familyOnlyMatch;

    return { family, normalizedModelId };
  }
};

/**
 * Whether the model only runs in thinking mode. DashScope rejects
 * `enable_thinking: false` for these models with 400
 * "The value of the enable_thinking parameter is restricted to True",
 * so a disabled `thinking` preference must never be forwarded.
 *
 * Rule: qwen-max from 3.8 onwards is thinking-only.
 * See https://help.aliyun.com/zh/model-studio/deep-thinking
 */
export const isThinkingForcedQwenModel = (model: string): boolean => {
  const parsed = parseQwenModelId(model);
  if (!parsed || parsed.family !== 'max' || parsed.majorVersion === undefined) return false;

  if (parsed.majorVersion > 3) return true;

  return parsed.majorVersion === 3 && (parsed.minorVersion ?? 0) >= 8;
};
