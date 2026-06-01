/**
 * JSON Schema specs for the self-iteration tool surface, faithful to the legacy
 * `createToolManifest(mode)` in
 * `src/server/services/agentSignal/services/selfIteration/execute.ts`.
 *
 * Split into resource (shared) / review / reflection groups so each mode package
 * assembles only the tools it exposes.
 */

interface ToolApiSpec {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
}

const str = { type: 'string' } as const;
const freeObj = { additionalProperties: true, type: 'object' } as const;
const freeArr = { items: { additionalProperties: true, type: 'object' }, type: 'array' } as const;

const obj = (
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): Record<string, unknown> => ({ properties, required: [...required], type: 'object' });

const evidenceRefsSchema = {
  items: {
    properties: {
      id: { description: 'Stable evidence identifier.', ...str },
      summary: { description: 'Optional note explaining why this evidence matters.', ...str },
      type: {
        description: 'Evidence object type.',
        enum: [
          'topic',
          'message',
          'operation',
          'source',
          'receipt',
          'tool_call',
          'task',
          'agent_document',
          'memory',
        ],
        type: 'string',
      },
    },
    required: ['id', 'type'],
    type: 'object',
  },
  type: 'array',
} as const;

const ideaSchema = obj(
  {
    evidenceRefs: evidenceRefsSchema,
    idempotencyKey: str,
    rationale: str,
    risk: { enum: ['low', 'medium', 'high'], type: 'string' },
    target: freeObj,
    title: str,
  },
  ['idempotencyKey', 'rationale', 'risk', 'evidenceRefs'],
);

const intentSchema = obj(
  {
    confidence: { type: 'number' },
    downgradeReason: {
      enum: ['approval_required', 'low_confidence', 'unsupported_in_reflection'],
      type: 'string',
    },
    evidenceRefs: evidenceRefsSchema,
    idempotencyKey: str,
    intentType: { enum: ['memory', 'skill', 'tooling', 'workflow'], type: 'string' },
    operation: freeObj,
    rationale: str,
    risk: { enum: ['low', 'medium', 'high'], type: 'string' },
    target: freeObj,
    title: str,
    urgency: { enum: ['immediate', 'soon', 'later'], type: 'string' },
  },
  ['idempotencyKey', 'intentType', 'confidence', 'urgency', 'rationale', 'evidenceRefs'],
);

export const RESOURCE_TOOL_APIS: ToolApiSpec[] = [
  {
    description: 'List managed skills visible in the reviewed agent scope.',
    name: 'listManagedSkills',
    parameters: obj({}),
  },
  {
    description: 'Read one managed skill by skill document id in the reviewed agent scope.',
    name: 'getManagedSkill',
    parameters: obj({ skillDocumentId: str }, ['skillDocumentId']),
  },
  {
    description:
      'Write one durable user memory when evidence explicitly states a stable normal-sensitivity user preference. Prefer this over skill tools for summary/style/preferences.',
    name: 'writeMemory',
    parameters: obj(
      { content: str, evidenceRefs: freeArr, idempotencyKey: str, proposalKey: str, summary: str },
      ['idempotencyKey', 'content', 'evidenceRefs'],
    ),
  },
  {
    description: 'Create one managed skill when no existing skill is selected.',
    name: 'createSkillIfAbsent',
    parameters: obj(
      {
        bodyMarkdown: str,
        description: str,
        idempotencyKey: str,
        name: str,
        proposalKey: str,
        summary: str,
        title: str,
      },
      ['idempotencyKey', 'name', 'bodyMarkdown'],
    ),
  },
  {
    description:
      'Replace one existing managed skill after compare-and-swap preflight. Provide baseSnapshot when available; the server completes it from skillDocumentId when omitted.',
    name: 'replaceSkillContentCAS',
    parameters: obj(
      {
        baseSnapshot: freeObj,
        bodyMarkdown: str,
        description: str,
        idempotencyKey: str,
        proposalKey: str,
        skillDocumentId: str,
        summary: str,
      },
      ['idempotencyKey', 'skillDocumentId', 'bodyMarkdown'],
    ),
  },
];

export const REVIEW_TOOL_APIS: ToolApiSpec[] = [
  {
    description: 'List active and historical self-review proposals in the reviewed agent scope.',
    name: 'listSelfReviewProposals',
    parameters: obj({}),
  },
  {
    description:
      'Read one self-review proposal by proposal id or proposalKey. Never use topic, message, tool_call, or document evidence ids here.',
    name: 'readSelfReviewProposal',
    parameters: obj({ proposalId: str, proposalKey: str }),
  },
  {
    description: 'Create one user-visible self-review proposal for later approval.',
    name: 'createSelfReviewProposal',
    parameters: obj(
      { actions: freeArr, idempotencyKey: str, metadata: freeObj, proposalKey: str, summary: str },
      ['idempotencyKey', 'proposalKey', 'summary', 'actions'],
    ),
  },
  {
    description: 'Refresh an existing self-review proposal after rechecking evidence.',
    name: 'refreshSelfReviewProposal',
    parameters: obj({ idempotencyKey: str, proposalId: str, proposalKey: str, summary: str }, [
      'idempotencyKey',
      'proposalId',
    ]),
  },
  {
    description: 'Supersede an existing self-review proposal with a replacement proposal key.',
    name: 'supersedeSelfReviewProposal',
    parameters: obj(
      { idempotencyKey: str, proposalId: str, proposalKey: str, summary: str, supersededBy: str },
      ['idempotencyKey', 'proposalId', 'supersededBy'],
    ),
  },
  {
    description: 'Close an existing self-review proposal with an optional lifecycle reason.',
    name: 'closeSelfReviewProposal',
    parameters: obj(
      { idempotencyKey: str, proposalId: str, proposalKey: str, reason: str, summary: str },
      ['idempotencyKey', 'proposalId'],
    ),
  },
  {
    description:
      'Record one non-actionable self-review idea or question as a Daily Brief artifact without creating an approval proposal.',
    name: 'recordSelfReviewIdea',
    parameters: ideaSchema,
  },
];

export const REFLECTION_TOOL_APIS: ToolApiSpec[] = [
  {
    description:
      'Record one immediate reflection idea into receipt metadata without creating a Daily Brief proposal.',
    name: 'recordReflectionIdea',
    parameters: ideaSchema,
  },
  {
    description:
      'Record one approval-gated, structural, unsupported, or low-confidence self-feedback intent into receipt metadata for later self-review.',
    name: 'recordSelfFeedbackIntent',
    parameters: intentSchema,
  },
];
