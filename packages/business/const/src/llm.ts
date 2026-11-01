/** Decision model selecting the Agents that reply in a channel. */
export const DEFAULT_CHANNEL_ROUTING_MODEL = 'jev-1.14.0';
export const DEFAULT_CHANNEL_ROUTING_PROVIDER = 'typesafe';

export const DEFAULT_EMBEDDING_PROVIDER = 'openai';

export const DEFAULT_MODEL = 'deepseek-v4-flash';
export const DEFAULT_PROVIDER = 'deepseek';
export const DEFAULT_MINI_MODEL = 'gpt-5.6-luna';
export const DEFAULT_MINI_PROVIDER = 'openai';

/**
 * The model that scores "is this message talking to the bot?" before a bot joins a conversation
 * nobody addressed to it. It sits on the path to a reply and has a 2s deadline, so it is a
 * decision model: one pass over the input that answers typed questions with probabilities,
 * instead of a chat model that generates JSON. The cloud build points it at its own Jev route.
 * `engine: 'chat'` points it at a chat model (for example DeepSeek flash) when a deployment has
 * no decision model.
 */
export const DEFAULT_BOT_WAKE_ENGINE: 'chat' | 'decision' = 'decision';
export const DEFAULT_BOT_WAKE_MODEL = 'gpt-6-luna:decision';
export const DEFAULT_BOT_WAKE_PROVIDER = 'openai';

/**
 * The speech-to-text model that transcribes voice messages for runtimes that only take text
 * (heterogeneous agents). It only takes effect once its provider is enabled, so a deployment
 * without that provider keeps voice input for those agents hidden.
 */
export const DEFAULT_ASR_MODEL = 'gpt-4o-mini-transcribe';
export const DEFAULT_ASR_PROVIDER = 'openai';

export const DEFAULT_ONBOARDING_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_ONBOARDING_PROVIDER = 'google';

/**
 * The model Acceptance review predictions judge evidence screenshots with.
 * MUST be vision-capable — a text-only model silently "accepts on missing
 * evidence" for every check and no proposal ever surfaces (a model-bank
 * test in apps/server guards this).
 *
 * Changing it is not free: a prediction counts as current only while its
 * provider + model + prompt version all match (`isCurrentReviewPrediction`), so
 * every stored prediction from the previous model is re-judged, and agreement
 * stats gathered under it cannot be pooled with the new ones. Treat a swap as
 * opening a new cohort rather than a routine version bump.
 */
export const DEFAULT_REVIEW_PREDICT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_REVIEW_PREDICT_PROVIDER = 'google';

/**
 * The model the Verify LobeHub LLM calls judge a deliverable with when neither
 * a pinned verifier agent nor a usable parent model is available. MUST be
 * vision-capable — agent-type checks attach screenshot evidence, and a
 * text-only verifier cannot read the frames it is judging (it has to detour
 * through a vision sub-agent, and the long tail is exactly where verdict
 * submission breaks down). Kept here next to REVIEW_PREDICT so the cloud
 * build can pin both judge models in one place; a model-bank test in
 * apps/server guards the vision ability.
 */
export const DEFAULT_VERIFY_MODEL = 'glm-5.3-flash';
export const DEFAULT_VERIFY_PROVIDER = 'zhipu';

/**
 * The model that splits an acceptance requirement into named verify criteria
 * (run-start plan instantiation and the task "generate criteria" action). A
 * text-only structured-output call, so it is pinned separately from the
 * vision-capable judge above: inheriting the verifier's chat model let a
 * reasoning model burn its budget and return no parsable JSON, which silently
 * collapsed every checklist to the single holistic fallback row.
 */
export const DEFAULT_VERIFY_PLAN_MODEL = 'deepseek-flash';
export const DEFAULT_VERIFY_PLAN_PROVIDER = 'deepseek';
