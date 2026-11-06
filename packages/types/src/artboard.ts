import { z } from 'zod';

export const ARTBOARD_FRAME_SIZE = { height: 400, width: 640 } as const;

export const ARTBOARD_GROUP_KINDS = ['journey', 'options', 'references', 'other'] as const;
export type ArtboardGroupKind = (typeof ARTBOARD_GROUP_KINDS)[number];

export const ARTBOARD_NOTE_KINDS = ['title', 'subtitle', 'sticky'] as const;
export type ArtboardNoteKind = (typeof ARTBOARD_NOTE_KINDS)[number];

export const ARTBOARD_PHASES = ['discuss', 'finalized'] as const;
export type ArtboardPhase = (typeof ARTBOARD_PHASES)[number];

const text = z.string();
const coordinate = z.number().finite();

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

export const artboardFrameSourceSchema = z.discriminatedUnion('kind', [
  canvasSourceSchema,
  imageSourceSchema,
]);
export type ArtboardFrameSource = z.infer<typeof artboardFrameSourceSchema>;

export const artboardFrameSourceInputSchema = z.discriminatedUnion('kind', [
  canvasSourceSchema.extend({ version: z.number().int().positive().optional() }),
  z.object({ fileRef: z.string().min(1), kind: z.literal('image') }),
]);
export type ArtboardFrameSourceInput = z.infer<typeof artboardFrameSourceInputSchema>;

const groupSchema = z.object({
  desc: text,
  id: z.string().min(1),
  kind: z.enum(ARTBOARD_GROUP_KINDS),
  title: text,
});
export type ArtboardGroup = z.infer<typeof groupSchema>;

const checkSchema = z.object({ expected: text });

const frameSchema = z.object({
  check: checkSchema.optional(),
  flowNodeId: z.string().optional(),
  groupId: z.string().min(1),
  id: z.string().min(1),
  recommended: z.boolean().optional(),
  source: artboardFrameSourceSchema,
  title: text,
  x: coordinate,
  y: coordinate,
});
export type ArtboardFrame = z.infer<typeof frameSchema>;

const arrowSchema = z.object({
  flowEdgeId: z.string().optional(),
  from: z.string().min(1),
  id: z.string().min(1),
  label: text,
  to: z.string().min(1),
});
export type ArtboardArrow = z.infer<typeof arrowSchema>;

const questionSchema = z.object({
  decision: text.optional(),
  status: z.enum(['open', 'decided']),
  suggestion: text.optional(),
});
export type ArtboardQuestion = z.infer<typeof questionSchema>;

const noteSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(ARTBOARD_NOTE_KINDS),
    question: questionSchema.optional(),
    text,
    w: z.number().positive().optional(),
    x: coordinate,
    y: coordinate,
  })
  .refine((note) => !note.question || note.kind === 'sticky', {
    message: 'Only a sticky note can carry a question',
    path: ['question'],
  });
export type ArtboardNote = z.infer<typeof noteSchema>;

export const artboardContentSchema = z.object({
  arrows: z.array(arrowSchema),
  frames: z.array(frameSchema),
  groups: z.array(groupSchema),
  notes: z.array(noteSchema),
});
export type ArtboardContent = z.infer<typeof artboardContentSchema>;

export const EMPTY_ARTBOARD_CONTENT: ArtboardContent = {
  arrows: [],
  frames: [],
  groups: [],
  notes: [],
};

const ref = z.string().min(1).optional();

const frameFields = {
  groupId: z.string().min(1),
  recommended: z.boolean().optional(),
  source: artboardFrameSourceInputSchema,
  title: text,
  x: coordinate,
  y: coordinate,
};

export const artboardOpSchema = z.discriminatedUnion('type', [
  z.object({
    group: z.object({ desc: text.optional(), kind: z.enum(ARTBOARD_GROUP_KINDS), title: text }),
    ref,
    type: z.literal('addGroup'),
  }),
  z.object({
    id: z.string(),
    patch: z.object({ desc: text, kind: z.enum(ARTBOARD_GROUP_KINDS), title: text }).partial(),
    type: z.literal('updateGroup'),
  }),
  z.object({ id: z.string(), type: z.literal('removeGroup') }),
  z.object({
    frame: z.object({ ...frameFields, check: checkSchema.optional() }),
    ref,
    type: z.literal('addFrame'),
  }),
  z.object({
    id: z.string(),
    patch: z.object(frameFields).partial(),
    type: z.literal('updateFrame'),
  }),
  z.object({ id: z.string(), type: z.literal('removeFrame') }),
  z.object({
    arrow: z.object({ from: z.string(), label: text, to: z.string() }),
    ref,
    type: z.literal('addArrow'),
  }),
  z.object({ id: z.string(), type: z.literal('removeArrow') }),
  z.object({
    note: z.object({
      kind: z.enum(ARTBOARD_NOTE_KINDS),
      question: z.object({ suggestion: text.optional() }).optional(),
      text,
      w: z.number().positive().optional(),
      x: coordinate,
      y: coordinate,
    }),
    ref,
    type: z.literal('addNote'),
  }),
  z.object({
    id: z.string(),
    patch: z
      .object({
        question: z.object({ suggestion: text.optional() }).nullable(),
        text,
        w: z.number().positive(),
        x: coordinate,
        y: coordinate,
      })
      .partial(),
    type: z.literal('updateNote'),
  }),
  z.object({ id: z.string(), type: z.literal('removeNote') }),
  z.object({ expected: text, frameId: z.string(), type: z.literal('setCheck') }),
  z.object({ decision: text, noteId: z.string(), type: z.literal('decideQuestion') }),
]);
export type ArtboardOp = z.infer<typeof artboardOpSchema>;
export type ArtboardOpType = ArtboardOp['type'];

type WithResolvedSource<T> = T extends { frame: infer F }
  ? Omit<T, 'frame'> & { frame: Omit<F, 'source'> & { source: ArtboardFrameSource } }
  : T extends { patch: infer P; type: 'updateFrame' }
    ? Omit<T, 'patch'> & { patch: Omit<P, 'source'> & { source?: ArtboardFrameSource } }
    : T;

export type ResolvedArtboardOp = WithResolvedSource<ArtboardOp>;

export const artboardUserOpSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('moveItem'), x: coordinate, y: coordinate }),
  z.object({ decision: text, noteId: z.string(), type: z.literal('decideQuestion') }),
  z.object({ id: z.string(), text, type: z.literal('updateNoteText') }),
]);
export type ArtboardUserOp = z.infer<typeof artboardUserOpSchema>;

export interface ArtboardItem {
  acceptanceId: string | null;
  content: ArtboardContent;
  createdAt: Date;
  description: string | null;
  id: string;
  originTopicId: string | null;
  phase: ArtboardPhase;
  projectId: string | null;
  revision: number;
  taskId: string;
  title: string;
  updatedAt: Date;
}

export interface ArtboardResultLineInput {
  frameCount: number;
  groupCount: number;
  id: string;
  revision: number;
}

export const formatArtboardResultLine = ({
  frameCount,
  groupCount,
  id,
  revision,
}: ArtboardResultLineInput) =>
  `artboard ${id} · revision ${revision} · ${groupCount} groups · ${frameCount} frames`;

const RESULT_LINE = /^artboard (\S+) · revision (\d+) · \d+ groups · \d+ frames$/m;

export const parseArtboardResultLine = (output: string) => {
  const match = RESULT_LINE.exec(output);
  return match ? { artboardId: match[1], revision: Number(match[2]) } : undefined;
};
