import { z } from 'zod';

export const SAVE_USER_QUESTION_FIELDS = [
  'agentEmoji',
  'agentName',
  'fullName',
  'interests',
  'responseLanguage',
] as const;

export const AGENT_ONBOARDING_STRUCTURED_FIELDS = SAVE_USER_QUESTION_FIELDS;

export type SaveUserQuestionField = (typeof SAVE_USER_QUESTION_FIELDS)[number];
export type AgentOnboardingStructuredField = SaveUserQuestionField;

export const AGENT_ONBOARDING_NODES = [
  'agentIdentity',
  'userIdentity',
  'workStyle',
  'workContext',
  'painPoints',
  'responseLanguage',
  'summary',
] as const;

export type UserAgentOnboardingNode = (typeof AGENT_ONBOARDING_NODES)[number];

export interface SaveUserQuestionInput {
  agentEmoji?: string;
  agentName?: string;
  fullName?: string;
  interests?: string[];
  responseLanguage?: string;
}

export interface UserOnboardingAgentIdentity {
  emoji: string;
  name: string;
  nature: string;
  vibe: string;
}

export interface UserOnboardingDimensionIdentity {
  domainExpertise?: string;
  name?: string;
  professionalRole?: string;
  summary: string;
}

export interface UserOnboardingDimensionWorkStyle {
  communicationStyle?: string;
  decisionMaking?: string;
  socialMode?: string;
  summary: string;
  thinkingPreferences?: string;
  workStyle?: string;
}

export interface UserOnboardingDimensionWorkContext {
  activeProjects?: string[];
  currentFocus?: string;
  interests?: string[];
  summary: string;
  thisQuarter?: string;
  thisWeek?: string;
  tools?: string[];
}

export interface UserOnboardingDimensionPainPoints {
  blockedBy?: string[];
  frustrations?: string[];
  noTimeFor?: string[];
  summary: string;
}

export interface UserOnboardingProfile {
  currentFocus?: string;
  identity?: UserOnboardingDimensionIdentity;
  interests?: string[];
  painPoints?: UserOnboardingDimensionPainPoints;
  workContext?: UserOnboardingDimensionWorkContext;
  workStyle?: UserOnboardingDimensionWorkStyle;
}

export interface UserAgentOnboardingQuestionFieldOption {
  label: string;
  value: string;
}

export interface UserAgentOnboardingQuestionField {
  key: string;
  kind: 'emoji' | 'multiselect' | 'select' | 'text' | 'textarea';
  label: string;
  options?: UserAgentOnboardingQuestionFieldOption[];
  placeholder?: string;
  required?: boolean;
  value?: string | string[];
}

export interface UserAgentOnboardingQuestionChoicePayload {
  kind: 'message' | 'patch';
  message?: string;
  patch?: Record<string, unknown>;
  targetNode?: UserAgentOnboardingNode;
}

export interface UserAgentOnboardingQuestionChoice {
  id: string;
  label: string;
  payload?: UserAgentOnboardingQuestionChoicePayload;
  style?: 'danger' | 'default' | 'primary';
}

export interface UserAgentOnboardingQuestionDraft {
  choices?: UserAgentOnboardingQuestionChoice[];
  description?: string;
  fields?: UserAgentOnboardingQuestionField[];
  id: string;
  metadata?: Record<string, unknown>;
  mode: 'button_group' | 'composer_prefill' | 'form' | 'info' | 'select';
  priority?: 'primary' | 'secondary';
  prompt: string;
  submitMode?: 'message' | 'tool';
}

export interface UserAgentOnboardingQuestion extends UserAgentOnboardingQuestionDraft {
  node: UserAgentOnboardingNode;
}

export const ONBOARDING_PHASES = [
  'agent_identity',
  'user_identity',
  'discovery',
  'summary',
] as const;

export const MIN_DISCOVERY_USER_MESSAGES = 5;
export const RECOMMENDED_DISCOVERY_USER_MESSAGES = 8;

export type OnboardingPhase = (typeof ONBOARDING_PHASES)[number];

export interface UserAgentOnboardingContext {
  discoveryUserMessageCount?: number;
  finished: boolean;
  missingStructuredFields: SaveUserQuestionField[];
  phase: OnboardingPhase;
  remainingDiscoveryExchanges?: number;
  topicId?: string;
  version: number;
}

export interface UserAgentOnboarding {
  activeTopicId?: string;
  agentIdentity?: UserOnboardingAgentIdentity;
  discoveryStartUserMessageCount?: number;
  draft?: UserAgentOnboardingDraft;
  finishedAt?: string;
  profile?: UserOnboardingProfile;
  version: number;
}

export interface UserAgentOnboardingUpdate {
  node: UserAgentOnboardingNode;
  patch: Record<string, unknown>;
}

export interface UserAgentOnboardingDraft {
  agentIdentity?: Partial<UserOnboardingAgentIdentity>;
  painPoints?: Partial<UserOnboardingDimensionPainPoints>;
  responseLanguage?: string;
  userIdentity?: Partial<UserOnboardingDimensionIdentity>;
  workContext?: Partial<UserOnboardingDimensionWorkContext>;
  workStyle?: Partial<UserOnboardingDimensionWorkStyle>;
}

const TrimmedNonEmptyStringSchema = z.string().trim().min(1);

export const SaveUserQuestionFieldSchema = z.enum(SAVE_USER_QUESTION_FIELDS);
export const AgentOnboardingStructuredFieldSchema = SaveUserQuestionFieldSchema;
export const UserAgentOnboardingNodeSchema = z.enum(AGENT_ONBOARDING_NODES);

export const SaveUserQuestionInputSchema = z
  .object({
    agentEmoji: TrimmedNonEmptyStringSchema.optional(),
    agentName: TrimmedNonEmptyStringSchema.optional(),
    fullName: TrimmedNonEmptyStringSchema.optional(),
    interests: z.array(TrimmedNonEmptyStringSchema).optional(),
    responseLanguage: TrimmedNonEmptyStringSchema.optional(),
  })
  .strict();

export const OnboardingPhaseSchema = z.enum(ONBOARDING_PHASES);

export const UserAgentOnboardingContextSchema = z
  .object({
    discoveryUserMessageCount: z.number().optional(),
    finished: z.boolean(),
    missingStructuredFields: z.array(SaveUserQuestionFieldSchema),
    phase: OnboardingPhaseSchema,
    remainingDiscoveryExchanges: z.number().optional(),
    topicId: z.string().optional(),
    version: z.number(),
  })
  .strict();

export const UserAgentOnboardingSchema = z
  .object({
    activeTopicId: z.string().optional(),
    discoveryStartUserMessageCount: z.number().optional(),
    finishedAt: z.string().optional(),
    version: z.number(),
  })
  .strict();

export const UserAgentOnboardingUpdateSchema = z
  .object({
    node: UserAgentOnboardingNodeSchema,
    patch: z.object({}).passthrough(),
  })
  .strict();
