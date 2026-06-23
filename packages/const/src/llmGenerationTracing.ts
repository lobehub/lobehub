/**
 * Canonical directory of every `llm_generation_tracing` scenario value.
 *
 * Add to this map whenever a new caller pipes through the tracing path so
 * there's one place to scan for all known scenarios. Values are the literal
 * strings persisted on the row's `scenario` column — keep them stable, they
 * are dashboard / partition keys.
 */
export const TRACING_SCENARIOS = {
  AgentSignal: 'agent_signal',
  AgentWelcome: 'agent_welcome',
  BuilderSuggestion: 'builder_suggestion',
  DocumentToSkillMeta: 'document_to_skill_meta',
  FollowUp: 'follow_up',
  HomeBrief: 'home_brief',
  InputCompletion: 'input_completion',
  MemoryExtract: 'memory_extract',
  SignalFeedbackDomain: 'signal_feedback_domain',
  SignalFeedbackSatisfaction: 'signal_feedback_satisfaction',
  SignalSkillIntent: 'signal_skill_intent',
  SignalSkillManagement: 'signal_skill_management',
  SignupEmailReview: 'signup_email_review',
  TaskBrief: 'task_brief',
  TaskBriefJudge: 'task_brief_judge',
  TaskHandoff: 'task_handoff',
  TopicTitle: 'topic_title',
  Unknown: 'unknown',
  VerifyJudge: 'verify_judge',
  VerifyPlanGen: 'verify_plan_gen',
} as const;

export type TracingScenario = (typeof TRACING_SCENARIOS)[keyof typeof TRACING_SCENARIOS];
