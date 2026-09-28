import type { AiModelReasoningConfig, ModelAbilities } from 'model-bank';

/** The subset of a model card the model-parameter rules read (bundled bank or user-enabled list). */
export interface ModelCardFacts {
  abilities?: ModelAbilities | null;
  /** Deployment alias some providers address the model by. */
  deploymentName?: string | null;
  displayName?: string | null;
  extendParams?: string[] | null;
  id: string;
  knowledgeCutoff?: string | null;
  providerId: string;
}

/** The user's own row for the model, when they edited or created one. */
export interface UserModelRowFacts {
  /** Stored as untyped JSON; a non-empty object replaces the card's abilities. */
  abilities?: unknown;
  displayName?: string | null;
  /** `[]` is an explicit opt-out from the card's params; absent falls back to the cards. */
  extendParams?: string[] | null;
}

/** What a model can take natively, as the run decided it. */
export type ModelMediaCapabilities = Pick<ModelAbilities, 'audio' | 'video' | 'vision'>;

/**
 * Every model fact an operation read once when it was created: the cards the
 * rules match against, the user's own model row, the media capabilities and the
 * reasoning config that won the topic-pin → user-config precedence.
 *
 * Carried on `AgentState.modelRuntimeConfig` (plain JSON, like the rest of the
 * state) so all of a run's LLM attempts — first step, last step and every retry
 * in between — resolve their parameters from one snapshot. A model or effort the
 * user edits mid-run belongs to the next turn, not to this one.
 */
export interface FrozenModelFacts {
  /** The provider's card for `model` plus, when it exists, the canonical card of the same id under another provider. */
  cards: ModelCardFacts[];
  mediaCapabilities?: ModelMediaCapabilities;
  /** The model the facts were read for; a mismatch (e.g. a compression model) means resolve live. */
  model: string;
  provider: string;
  /** Absent when the model cannot consume reasoning params at all. */
  reasoningConfig?: AiModelReasoningConfig;
  userModelRow?: UserModelRowFacts;
}
