import type { BuiltinToolManifest, GoalReportMetadata } from '@lobechat/types';

export const GoalReportIdentifier = 'lobe-goal-report';
export const GoalReportApiName = {
  readGoalGraph: 'readGoalGraph',
  submitGoalReport: 'submitGoalReport',
} as const;

export interface ReadGoalGraphParams {
  goalId: string;
}

export interface SubmitGoalReportParams extends Omit<GoalReportMetadata, 'graphCursor'> {
  /** The full written report, in markdown, built from the same storyline. */
  content: string;
  goalId: string;
  /** The graph cursor from the skeleton; the newest Goal event when omitted. */
  graphCursor?: string;
}

const ids = { items: { type: 'string' }, type: 'array' };

export const GoalReportManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Read the Goal graph this report is about: every node with its kind, status and description, the edges between them, decision gates and the Work versions linked to each node. Use it to check what the skeleton in your instruction points at.',
      name: GoalReportApiName.readGoalGraph,
      parameters: {
        additionalProperties: false,
        properties: { goalId: { type: 'string' } },
        required: ['goalId'],
        type: 'object',
      },
    },
    {
      description:
        'Submit the Goal wrap-up report. The storyline (headline, chapters with their main-path nodes, findings and Work versions, detours with reason and lesson, next steps) is stored as structured metadata and `content` as the full markdown report; each call appends a new report version. The mainline marks the nodes and edges of the path that led to the result; chapters tell exactly that path. Every id must belong to this Goal: chapter and mainline nodeIds must be resolved, mainline edges must join two mainline nodes, detour nodeIds must be rejected, retired or superseded (revises / contradicts). A rejected call lists every invalid reference — fix them and call again.',
      name: GoalReportApiName.submitGoalReport,
      parameters: {
        additionalProperties: false,
        properties: {
          chapters: {
            items: {
              additionalProperties: false,
              properties: {
                detours: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      kind: { enum: ['dead_end', 'superseded', 'retry'], type: 'string' },
                      lesson: { type: 'string' },
                      nodeIds: ids,
                      reason: { type: 'string' },
                      title: { type: 'string' },
                    },
                    required: ['title', 'reason', 'lesson', 'nodeIds', 'kind'],
                    type: 'object',
                  },
                  type: 'array',
                },
                findingIds: ids,
                narrative: { type: 'string' },
                nodeIds: ids,
                title: { type: 'string' },
                workVersionIds: ids,
              },
              required: ['title', 'narrative', 'nodeIds'],
              type: 'object',
            },
            type: 'array',
          },
          content: {
            description: 'The full written report in markdown, built from the metadata above.',
            type: 'string',
          },
          deliverableWorkId: { type: 'string' },
          goalId: { type: 'string' },
          graphCursor: {
            description: 'The graph cursor given in the instruction.',
            type: 'string',
          },
          headline: { description: 'One sentence: what the Goal delivered.', type: 'string' },
          mainline: {
            additionalProperties: false,
            description:
              'The path that led to the result, highlighted on the exploration map. nodeIds: the resolved tasks on it (optionally the resolved root problem and the findings that carried the answer); edgeIds: edges of this Goal whose both ends are mainline nodes. Chapters must tell exactly these tasks.',
            properties: { edgeIds: ids, nodeIds: ids },
            required: ['nodeIds', 'edgeIds'],
            type: 'object',
          },
          nextSteps: {
            items: {
              additionalProperties: false,
              properties: {
                nodeIds: ids,
                reason: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['title', 'reason'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['goalId', 'headline', 'chapters', 'mainline', 'nextSteps', 'content'],
        type: 'object',
      },
    },
  ],
  identifier: GoalReportIdentifier,
  meta: {
    avatar: '🎯',
    description: 'Submit the Goal wrap-up report storyline',
    title: 'Goal report',
  },
  systemRole:
    'You are writing the wrap-up report of a finished Goal. Use readGoalGraph to inspect it. Only submitGoalReport records the report; a prose answer does not. Reference only ids that appear in the Goal graph.',
  type: 'builtin',
};
