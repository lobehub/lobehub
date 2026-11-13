import { z } from 'zod';

export const ARTBOARD_PHASES = ['discuss', 'finalized'] as const;
export type ArtboardPhase = (typeof ARTBOARD_PHASES)[number];

export const ARTBOARD_GROUP_KINDS = ['journey', 'options', 'references', 'other'] as const;
export type ArtboardGroupKind = (typeof ARTBOARD_GROUP_KINDS)[number];

export const ARTBOARD_ROUND_STATUSES = ['open', 'submitted'] as const;
export type ArtboardRoundStatus = (typeof ARTBOARD_ROUND_STATUSES)[number];

export const ARTBOARD_BOARD_TYPES = ['html', 'image', 'video', 'decision'] as const;
export type ArtboardBoardType = (typeof ARTBOARD_BOARD_TYPES)[number];

export const ARTBOARD_DEFAULT_PAGE_NAME = 'Page 1';

// A group's rect is in page coordinates and its top-left is the origin for the boards inside it;
// a board outside any group is in page coordinates.
export interface ArtboardRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type ArtboardCommentAnchor =
  | { type: 'canvas'; x: number; y: number }
  // offsetX / offsetY are fractions (0–1) of the hit element's width and height.
  | { nodePath: string; offsetX: number; offsetY: number; type: 'node' };

export interface ArtboardEdgeMetadata {}

export interface ArtboardMetadata {}
export interface ArtboardPageMetadata {}
export interface ArtboardRoundMetadata {
  batchId?: string;
}
export interface ArtboardGroupMetadata {}
export interface ArtboardBoardMetadata {}
export interface ArtboardCommentMetadata {}

export const ARTBOARD_BOARD_SIZE = { height: 400, width: 640 } as const;

const text = z.string();
const coordinate = z.number().finite();
const size = z.number().finite().positive();

const canvasSourceSchema = z.object({
  canvasId: z.string().min(1),
  kind: z.literal('canvas'),
  path: z.string().min(1).optional(),
  version: z.number().int().positive(),
});

const imageSourceSchema = z.object({
  fileId: z.string().min(1),
  kind: z.literal('image'),
});

export const artboardBoardSourceSchema = z.discriminatedUnion('kind', [
  canvasSourceSchema,
  imageSourceSchema,
]);
export type ArtboardBoardSource = z.infer<typeof artboardBoardSourceSchema>;

export const artboardBoardSourceInputSchema = z.discriminatedUnion('kind', [
  canvasSourceSchema.extend({ version: z.number().int().positive().optional() }),
  z.object({ fileRef: z.string().min(1), kind: z.literal('image') }),
]);
export type ArtboardBoardSourceInput = z.infer<typeof artboardBoardSourceInputSchema>;

export interface ArtboardPageView {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ArtboardRoundView {
  batchId: string | null;
  chosenBoardId: string | null;
  id: string;
  pageId: string;
  recommendedBoardId: string | null;
  status: ArtboardRoundStatus;
  title: string;
}

export interface ArtboardGroupView {
  desc: string;
  id: string;
  kind: ArtboardGroupKind;
  pageId: string;
  // Page coordinates; the service derives it from the boards inside.
  rect: ArtboardRect;
  title: string;
}

export interface ArtboardBoardView {
  expected: string | null;
  flowNodeId: string | null;
  groupId: string | null;
  id: string;
  pageId: string;
  // Page coordinates, also for a board inside a group.
  rect: ArtboardRect;
  roundId: string | null;
  // null for a decision board, and for a board whose Canvas or file is gone.
  source: ArtboardBoardSource | null;
  title: string;
  type: ArtboardBoardType;
}

export interface ArtboardEdgeView {
  condition: string | null;
  flowEdgeId: string | null;
  from: string;
  id: string;
  isDefault: boolean;
  label: string;
  to: string;
}

export interface ArtboardQuestionView {
  boardId: string | null;
  content: string;
  groupId: string | null;
  id: string;
  pageId: string | null;
}

export interface ArtboardContent {
  boards: ArtboardBoardView[];
  edges: ArtboardEdgeView[];
  groups: ArtboardGroupView[];
  pages: ArtboardPageView[];
  questions: ArtboardQuestionView[];
  rounds: ArtboardRoundView[];
}

export interface ArtboardItem {
  acceptanceId: string | null;
  content: ArtboardContent;
  createdAt: Date;
  description: string | null;
  id: string;
  phase: ArtboardPhase;
  projectId: string | null;
  revision: number;
  taskId: string | null;
  title: string;
  topicId: string | null;
  updatedAt: Date;
}

export interface ArtboardCommentView {
  authorAgentId: string | null;
  authorUserId: string | null;
  content: string;
  createdAt: Date;
  id: string;
}

export interface ArtboardCommentThreadView extends ArtboardCommentView {
  anchor: ArtboardCommentAnchor | null;
  boardId: string | null;
  groupId: string | null;
  pageId: string | null;
  replies: ArtboardCommentView[];
  resolvedAt: Date | null;
}

const ref = z.string().min(1).optional();
const id = z.string().min(1);

const boardFields = {
  expected: text.optional(),
  groupId: id.optional(),
  h: size.optional(),
  pageId: id.optional(),
  recommended: z.boolean().optional(),
  roundId: id.optional(),
  source: artboardBoardSourceInputSchema.optional(),
  title: text,
  type: z.enum(ARTBOARD_BOARD_TYPES).optional(),
  w: size.optional(),
  x: coordinate,
  y: coordinate,
};

const groupFields = {
  desc: text.optional(),
  kind: z.enum(ARTBOARD_GROUP_KINDS),
  pageId: id.optional(),
  title: text,
};

export const artboardOpSchema = z.discriminatedUnion('type', [
  z.object({ page: z.object({ name: text.min(1) }), ref, type: z.literal('addPage') }),
  z.object({ id, patch: z.object({ name: text.min(1) }), type: z.literal('updatePage') }),
  z.object({ id, type: z.literal('removePage') }),
  z.object({
    ref,
    round: z.object({ batchId: id.optional(), pageId: id.optional(), title: text.min(1) }),
    type: z.literal('addRound'),
  }),
  z.object({ id, patch: z.object({ title: text.min(1) }), type: z.literal('updateRound') }),
  z.object({ group: z.object(groupFields), ref, type: z.literal('addGroup') }),
  z.object({
    id,
    patch: z.object({ desc: text, kind: z.enum(ARTBOARD_GROUP_KINDS), title: text }).partial(),
    type: z.literal('updateGroup'),
  }),
  z.object({ id, type: z.literal('removeGroup') }),
  z.object({ board: z.object(boardFields), ref, type: z.literal('addBoard') }),
  z.object({
    id,
    patch: z
      .object({
        ...boardFields,
        groupId: id.nullable(),
        roundId: id.nullable(),
      })
      .omit({ pageId: true, type: true })
      .partial(),
    type: z.literal('updateBoard'),
  }),
  z.object({ id, type: z.literal('removeBoard') }),
  z.object({
    edge: z.object({
      condition: text.optional(),
      from: id,
      isDefault: z.boolean().optional(),
      label: text,
      to: id,
    }),
    ref,
    type: z.literal('addEdge'),
  }),
  z.object({ id, type: z.literal('removeEdge') }),
  z.object({ boardId: id, expected: text, type: z.literal('setCheck') }),
]);
export type ArtboardOp = z.infer<typeof artboardOpSchema>;
export type ArtboardOpType = ArtboardOp['type'];

export interface ArtboardResultLineInput {
  boardCount: number;
  groupCount: number;
  id: string;
  revision: number;
}

export const formatArtboardResultLine = ({
  boardCount,
  groupCount,
  id: artboardId,
  revision,
}: ArtboardResultLineInput) =>
  `artboard ${artboardId} · revision ${revision} · ${groupCount} groups · ${boardCount} boards`;

const RESULT_LINE = /^artboard (\S+) · revision (\d+) · \d+ groups · \d+ boards$/m;

export const parseArtboardResultLine = (output: string) => {
  const match = RESULT_LINE.exec(output);
  return match ? { artboardId: match[1], revision: Number(match[2]) } : undefined;
};
