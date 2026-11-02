export const HARNESS_AGENT_PROMPT =
  '  User-authored Agent Prompt\n\tkeep every byte and never rewrite this instruction.  ';

export const HARNESS_BUDGET_AGENT_PROMPT = 'T105 budget-pressure control prompt.';

export const HARNESS_BASELINE_USER_MESSAGE =
  'T105_BASELINE compare identical Agent Prompt and user turn';

export interface PromptScenario {
  afterFixturePaths?: readonly string[];
  agentId: string;
  agentPrompt: string;
  beforeFixturePaths?: readonly string[];
  expectation: {
    degradeReasons?: string[];
    dynamicKinds?: string[];
    manualSkillName?: string;
    minCapturedRequests?: number;
    requiredUserMessages?: string[];
    toolSuffixes?: string[];
    traceMode: 'default' | 'on-demand';
  };
  id: string;
  manualOnly?: boolean;
  prompt: string;
  requiresUi?: boolean;
  selectedSkills?: string[];
  title: string;
  topicFromScenarioId?: string;
  topicId?: string;
}

const ON_DEMAND_AGENT_ID = 'agt_yLie7JpbUr2K';
const LEGACY_AGENT_ID = 'agt_T101LEGACY01';
const LEGACY_CHAT_AGENT_ID = 'agt_T106CHAT01';
const BUDGET_PRESSURE_AGENT_ID = 'agt_T105BUDGET01';
const UI_INTERVENTION_AGENT_ID = 'agt_T106UI01';
const NEGATIVE_ACTIVATION_AGENT_ID = 'agt_T106NEGATIVE01';
const PROTECTED_BUDGET_AGENT_ID = 'agt_T106PROTECTED01';

export const PROMPT_SCENARIOS: readonly PromptScenario[] = [
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      dynamicKinds: ['document_card', 'environment', 'skill_card', 'tool_card'],
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'baseline-on-demand',
    prompt: HARNESS_BASELINE_USER_MESSAGE,
    title: 'On-demand baseline with the same prompt and user turn as legacy',
  },
  {
    agentId: LEGACY_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      minCapturedRequests: 1,
      traceMode: 'default',
    },
    id: 'baseline-legacy',
    prompt: HARNESS_BASELINE_USER_MESSAGE,
    title: 'Legacy baseline with the same prompt and user turn as on-demand',
  },
  {
    agentId: LEGACY_CHAT_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      minCapturedRequests: 1,
      traceMode: 'default',
    },
    id: 'baseline-chat',
    prompt: HARNESS_BASELINE_USER_MESSAGE,
    title: 'Legacy chat control with the same prompt and user turn as agent mode',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      dynamicKinds: ['preference'],
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'memory',
    prompt: 'T105_MEMORY release rollback deployment constraint',
    title: 'Memory retrieval candidate injection',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    afterFixturePaths: ['scripts/promptHarness/fixtures/memoryExpertiseCleanup.sql'],
    beforeFixturePaths: ['scripts/promptHarness/fixtures/memoryExpertise.sql'],
    expectation: {
      dynamicKinds: [
        'approved_expertise',
        'explicit_constraint',
        'preference',
        'unapproved_suggestion',
      ],
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'memory-expertise',
    prompt: 'T106 release rollback deployment priority and approval gate',
    title: 'Memory and expertise priority, provenance and approval gate',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      dynamicKinds: ['preference'],
      minCapturedRequests: 1,
      requiredUserMessages: ['T106 cooking preference low salt'],
      traceMode: 'on-demand',
    },
    id: 'memory-follow-up',
    prompt: 'T106 cooking preference low salt',
    title: 'A second user message on the same topic re-runs memory retrieval',
    topicFromScenarioId: 'memory-expertise',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      dynamicKinds: ['skill_card'],
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'skill',
    prompt: 'T105_SKILL find the LobeHub skill card without loading its body',
    title: 'Skill card discovery',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      minCapturedRequests: 3,
      toolSuffixes: ['activateSkill', 'readReference'],
      traceMode: 'on-demand',
    },
    id: 'skill-activation',
    prompt: 'T106_SKILL_FLOW activate lobehub and load one deterministic reference',
    title: 'Skill activation and reference loading',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      dynamicKinds: ['skill_card'],
      manualSkillName: 'lobehub',
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'manual-skill',
    prompt: 'T106_MANUAL_SKILL use the selected skill without asking again',
    selectedSkills: ['lobehub'],
    title: 'Manually selected Skill loads automatically',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      dynamicKinds: ['document_card'],
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'document',
    prompt: 'T105_DOCUMENT show the checkpoint document card without its body',
    title: 'Document card discovery',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      minCapturedRequests: 2,
      toolSuffixes: ['activateTools'],
      traceMode: 'on-demand',
    },
    id: 'tool-activation',
    prompt: 'T105_TOOL_ACTIVATION activate calculator for a deterministic tool contract',
    title: 'Tool activation and active contract',
  },
  {
    agentId: ON_DEMAND_AGENT_ID,
    agentPrompt: HARNESS_AGENT_PROMPT,
    expectation: {
      minCapturedRequests: 3,
      toolSuffixes: ['readDocument'],
      traceMode: 'on-demand',
    },
    id: 'long-document',
    prompt: 'T105_LONG_DOCUMENT read a long document in an explicit chapter window',
    title: 'Long document chapter load',
  },
  {
    agentId: UI_INTERVENTION_AGENT_ID,
    agentPrompt: 'T106 intervention UI control prompt.',
    expectation: {
      minCapturedRequests: 3,
      toolSuffixes: ['activateTools', 'askUserQuestion'],
      traceMode: 'on-demand',
    },
    id: 'ui-intervention',
    manualOnly: true,
    prompt: 'T106_INTERVENTION_UI activate user interaction and ask one deterministic question',
    requiresUi: true,
    title: 'Native activation approval and custom intervention UI',
  },
  {
    agentId: NEGATIVE_ACTIVATION_AGENT_ID,
    agentPrompt: 'T106 fail-closed activation control prompt.',
    expectation: {
      minCapturedRequests: 3,
      traceMode: 'on-demand',
    },
    id: 'negative-activation',
    prompt: 'T106_NEGATIVE_ACTIVATION prove missing and forged bundle identity fail closed',
    title: 'Missing bundle, forged version/hash and unpermitted tool fail closed',
  },
  {
    agentId: PROTECTED_BUDGET_AGENT_ID,
    agentPrompt: 'SAFETY RULE T106: destructive deployment is forbidden without two reviewers.',
    beforeFixturePaths: ['scripts/promptHarness/fixtures/protectedBudget.sql'],
    expectation: {
      degradeReasons: ['budget_exceeded'],
      dynamicKinds: ['document_card'],
      minCapturedRequests: 2,
      toolSuffixes: ['activateTools'],
      traceMode: 'on-demand',
    },
    id: 'protected-budget',
    prompt: 'T106_PROTECTED_BUDGET release rollback deployment needs a protected budget check',
    title: 'Safety and pending action survive active-tool budget pressure',
    topicId: 'tpc_T106PROTECTEDBUDGET',
  },
  {
    agentId: BUDGET_PRESSURE_AGENT_ID,
    agentPrompt: HARNESS_BUDGET_AGENT_PROMPT,
    expectation: {
      degradeReasons: ['budget_exceeded'],
      dynamicKinds: ['document_card'],
      minCapturedRequests: 1,
      traceMode: 'on-demand',
    },
    id: 'budget-pressure',
    prompt: 'T105_BUDGET_PRESSURE release rollback deployment low relevance memory',
    title: 'Shared budget pressure and degradation',
  },
] as const;

export const getScenario = (id: string): PromptScenario => {
  const scenario = PROMPT_SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`Unknown prompt scenario: ${id}`);
  return scenario;
};
