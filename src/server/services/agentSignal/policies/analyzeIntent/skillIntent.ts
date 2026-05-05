import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import type { GenerateObjectPayload, GenerateObjectSchema } from '@lobechat/model-runtime';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type {
  ClassifierDiagnosticsService,
  SkillIntentClassifierInput,
  SkillIntentClassifierService,
} from '../../services';
import type {
  AgentSignalClassifierErrorSummary,
  AgentSignalSkillIntentClassification,
  AgentSignalSkillIntentExplicitness,
  AgentSignalSkillIntentRoute,
} from '../types';

const log = debug('lobe-server:agent-signal:skill-intent:agent');

const SkillIntentClassificationSchema = z
  .object({
    actionIntent: z
      .enum(['create', 'refine', 'consolidate', 'maintain', 'noop'])
      .optional()
      .nullable(),
    confidence: z.number().min(0).max(1),
    explicitness: z.enum([
      'explicit_action',
      'implicit_strong_learning',
      'weak_positive',
      'non_skill_preference',
    ]),
    reason: z.string(),
    route: z.enum(['direct_decision', 'accumulate', 'non_skill']),
  })
  .transform(({ actionIntent, ...value }) => ({
    ...value,
    ...(actionIntent ? { actionIntent } : {}),
  }));

const SkillIntentGenerateObjectSchema = {
  name: 'agent_signal_skill_intent',
  schema: {
    additionalProperties: false,
    properties: {
      actionIntent: {
        enum: ['create', 'refine', 'consolidate', 'maintain', 'noop', null],
        type: ['string', 'null'],
      },
      confidence: { maximum: 1, minimum: 0, type: 'number' },
      explicitness: {
        enum: [
          'explicit_action',
          'implicit_strong_learning',
          'weak_positive',
          'non_skill_preference',
        ],
        type: 'string',
      },
      reason: { type: 'string' },
      route: { enum: ['direct_decision', 'accumulate', 'non_skill'], type: 'string' },
    },
    required: ['actionIntent', 'confidence', 'explicitness', 'reason', 'route'],
    type: 'object',
  },
  strict: true,
} satisfies GenerateObjectSchema;

const generateObjectRoles = ['assistant', 'system', 'user'] as const;

const isGenerateObjectRole = (
  role: string,
): role is GenerateObjectPayload['messages'][number]['role'] => {
  return generateObjectRoles.includes(role as (typeof generateObjectRoles)[number]);
};

const compactText = (value: string | undefined, maxLength = 1800): string | undefined => {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength)}...`;
};

const getTopicLabel = (serializedContext: string | undefined): string | undefined => {
  if (!serializedContext) return undefined;

  const topicMatch = /topic=([^;\n<]+)/i.exec(serializedContext);
  return topicMatch?.[1];
};

const readRecord = (value: unknown): Record<string, unknown> | undefined => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
};

const redactErrorText = (value: string, maxLength = 480): string => {
  const redacted = value
    .replaceAll(/(bearer\s+)[\w.-]+/gi, '$1[redacted-token]')
    .replaceAll(/(api[-_ ]?key["'=: ]+)[\w.-]{8,}/gi, '$1[redacted-key]')
    .replaceAll(/(invalid key[: ]+)[\w.-]{8,}/gi, '$1[redacted-key]')
    .replaceAll(/\bsk-[\w-]{8,}\b/gi, '[redacted-key]');

  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}...`;
};

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  const record = readRecord(error);
  const message = record?.message;
  if (typeof message === 'string') return message;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const readErrorName = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.name;

  const record = readRecord(error);
  const name = record?.name ?? record?.errorType ?? record?.code;
  return typeof name === 'string' ? name : undefined;
};

/**
 * Normalizes classifier fallback errors for trace-safe diagnostics.
 *
 * Before:
 * - `ProviderError: invalid key: sk-...`
 *
 * After:
 * - `{ name: "ProviderError", message: "invalid key: [redacted-key]" }`
 */
const normalizeClassifierError = (error: unknown): AgentSignalClassifierErrorSummary => {
  const record = readRecord(error);
  const cause = error instanceof Error ? error.cause : record?.cause;

  return {
    ...(cause === undefined ? {} : { cause: redactErrorText(readErrorMessage(cause)) }),
    message: redactErrorText(readErrorMessage(error)),
    ...(readErrorName(error) ? { name: readErrorName(error) } : {}),
  };
};

const hasSkillArtifactReference = (message: string) => {
  return /skill|技能|workflow|工作流|procedure|流程|checklist|检查清单/i.test(message);
};

const hasConversionVerb = (message: string) => {
  return /create|convert|turn into|make into|做成|变成|变为|转换|转成|沉淀|固化|整理成/i.test(
    message,
  );
};

const hasRefineVerb = (message: string) => {
  return /update|refine|补上|补充|加入|加上|更新|完善|改进|扩展/i.test(message);
};

const hasMergeVerb = (message: string) => {
  return /merge|consolidate|combine|deduplicate|合并|整合|去重/i.test(message);
};

const hasFutureProcedureReuse = (message: string) => {
  return /(?:以后|之后|下次|每次|遇到).*(?:[按照来]|沿用|复用|参考|执行)|(?:future|next time|going forward|later).*(?:follow|reuse|use|apply|run)/i.test(
    message,
  );
};

const hasGenericPositive = (message: string) => {
  return /有帮助|不错|挺好|清楚|works well|helpful|good/i.test(message);
};

const hasNegativePreference = (message: string) => {
  return /不适合|别这么做|不要.*做|以后.*别|以后.*不要|not suitable|do not do this|don't do this|avoid this/i.test(
    message,
  );
};

const createClassification = (
  explicitness: AgentSignalSkillIntentExplicitness,
  route: AgentSignalSkillIntentRoute,
  reason: string,
  confidence: number,
  actionIntent?: AgentSignalSkillIntentClassification['actionIntent'],
  classifierError?: AgentSignalClassifierErrorSummary,
): AgentSignalSkillIntentClassification => ({
  ...(actionIntent ? { actionIntent } : {}),
  ...(classifierError ? { classifierError } : {}),
  confidence,
  explicitness,
  reason,
  route,
});

/**
 * Classifies obvious skill intent with conservative deterministic rules.
 *
 * Before:
 * - "Convert the SKILL.md draft into a real skills/bundle."
 * - "This explanation is quite helpful."
 *
 * After:
 * - `{ explicitness: "explicit_action", route: "direct_decision" }`
 * - `{ explicitness: "weak_positive", route: "accumulate" }`
 */
export const classifySkillIntentByRules = (
  input: SkillIntentClassifierInput,
): AgentSignalSkillIntentClassification | undefined => {
  const message = input.message.trim();

  if (hasNegativePreference(message) && !hasSkillArtifactReference(message)) {
    return createClassification(
      'non_skill_preference',
      'non_skill',
      'negative future preference belongs outside skill management',
      0.82,
      'noop',
    );
  }

  if (hasSkillArtifactReference(message) && hasMergeVerb(message)) {
    return createClassification(
      'explicit_action',
      'direct_decision',
      'explicit skill consolidation request',
      0.9,
      'consolidate',
    );
  }

  if (/[\w-]+-skill/i.test(message) && hasRefineVerb(message)) {
    return createClassification(
      'explicit_action',
      'direct_decision',
      'explicit named skill refinement request',
      0.9,
      'refine',
    );
  }

  if (hasSkillArtifactReference(message) && hasRefineVerb(message)) {
    return createClassification(
      'explicit_action',
      'direct_decision',
      'explicit skill refinement request',
      0.88,
      'refine',
    );
  }

  if (hasSkillArtifactReference(message) && hasConversionVerb(message)) {
    return createClassification(
      'explicit_action',
      'direct_decision',
      'explicit skill artifact conversion request',
      0.92,
      'create',
    );
  }

  if (hasGenericPositive(message) && !hasFutureProcedureReuse(message)) {
    return createClassification(
      'weak_positive',
      'accumulate',
      'generic positive feedback without durable future-use instruction',
      0.78,
      'maintain',
    );
  }

  return undefined;
};

/**
 * Options for resolving skill intent after deterministic rules.
 */
export interface ClassifySkillIntentOptions {
  /** Diagnostics sink for fallback classifier failures. */
  diagnostics?: ClassifierDiagnosticsService;
  /** Optional classifier used when deterministic rules are intentionally inconclusive. */
  fallback?: SkillIntentClassifierService;
  /** Runtime scope key for diagnostics. */
  scopeKey?: string;
  /** Source id for diagnostics. */
  sourceId?: string;
}

/**
 * Resolves skill intent using rules first and a small fallback classifier second.
 *
 * Use when:
 * - Domain routing selected `skill`
 * - Action planning needs a direct, accumulation, or non-skill route
 *
 * Expects:
 * - `input.message` is the user feedback text
 * - `input.serializedContext` is compact same-turn evidence, not full documents
 *
 * Returns:
 * - A safe classification. Fallback failures become weak-positive accumulation.
 */
export const classifySkillIntent = async (
  input: SkillIntentClassifierInput,
  options: ClassifySkillIntentOptions = {},
): Promise<AgentSignalSkillIntentClassification> => {
  const ruleResult = classifySkillIntentByRules(input);
  if (ruleResult) return ruleResult;

  if (!options.fallback) {
    return createClassification(
      'weak_positive',
      'accumulate',
      'insufficient-evidence',
      0.35,
      'maintain',
    );
  }

  try {
    return SkillIntentClassificationSchema.parse(
      await options.fallback.classify({
        message: input.message,
        serializedContext: input.serializedContext,
        topicLabel: input.topicLabel ?? getTopicLabel(input.serializedContext),
      }),
    );
  } catch (error) {
    const classifierError = normalizeClassifierError(error);

    await options.diagnostics?.recordMalformedOutput({
      error,
      reason: 'malformed skill-intent classifier output',
      scopeKey: options.scopeKey ?? 'unknown',
      sourceId: options.sourceId,
      stage: 'skill-intent',
    });

    return createClassification(
      'weak_positive',
      'accumulate',
      'classifier-fallback-failed',
      0.35,
      'maintain',
      classifierError,
    );
  }
};

/**
 * Model configuration for the skill-intent classifier agent.
 */
export interface SkillIntentClassifierAgentModelConfig {
  model: string;
  provider: string;
}

const normalizeGenerateObjectMessages = (
  messages: GenerateObjectPayload['messages'],
): GenerateObjectPayload['messages'] => {
  return messages.map((message) => {
    if (!isGenerateObjectRole(message.role)) {
      throw new TypeError(`Unsupported skill-intent classifier message role: ${message.role}`);
    }

    return message;
  });
};

const createSkillIntentClassifierMessages = (
  input: SkillIntentClassifierInput,
): GenerateObjectPayload['messages'] => [
  {
    content:
      'Classify skill intent for Agent Signal. Return direct_decision only for explicit skill actions or implicit strong future-use procedural learning. Return accumulate for generic praise or weak approval. Return non_skill for user preference that does not belong to skill management. Do not author skills.',
    role: 'system',
  },
  {
    content: JSON.stringify({
      message: input.message,
      serializedContext: compactText(input.serializedContext),
      topicLabel: input.topicLabel,
    }),
    role: 'user',
  },
];

/**
 * Model-backed skill-intent classifier for ambiguous skill-domain feedback.
 *
 * Use when:
 * - Deterministic rules cannot safely classify the skill-domain feedback
 * - A small no-document-content model decision is acceptable
 *
 * Expects:
 * - `db` and `userId` identify the current Agent Signal user context
 * - `serializedContext` is already compact
 *
 * Returns:
 * - One parsed skill-intent classification
 */
export class SkillIntentClassifierAgentService implements SkillIntentClassifierService {
  private readonly db: LobeChatDatabase;
  private readonly modelConfig: SkillIntentClassifierAgentModelConfig;
  private readonly userId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    modelConfig: Partial<SkillIntentClassifierAgentModelConfig> = {},
  ) {
    this.db = db;
    this.userId = userId;
    this.modelConfig = {
      model: modelConfig.model ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
      provider: modelConfig.provider ?? DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
    };
  }

  /**
   * Classifies one ambiguous skill-domain feedback message.
   *
   * Use when:
   * - Rule classification returned no confident decision
   * - Runtime policy wiring provided model dependencies
   *
   * Expects:
   * - No full document content in the serialized context
   *
   * Returns:
   * - One Zod-validated skill-intent classification
   */
  async classify(input: SkillIntentClassifierInput): Promise<AgentSignalSkillIntentClassification> {
    const modelRuntime = await initModelRuntimeFromDB(
      this.db,
      this.userId,
      this.modelConfig.provider,
    );

    log(
      'classifySkillIntent model=%s provider=%s',
      this.modelConfig.model,
      this.modelConfig.provider,
    );

    const result = await modelRuntime.generateObject(
      {
        messages: normalizeGenerateObjectMessages(createSkillIntentClassifierMessages(input)),
        model: this.modelConfig.model,
        schema: SkillIntentGenerateObjectSchema,
      },
      { metadata: { trigger: RequestTrigger.AgentSignal } },
    );

    return SkillIntentClassificationSchema.parse(result);
  }
}
