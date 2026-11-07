import {
  type ArtboardContent,
  artboardContentSchema,
  type ArtboardFrame,
  type ArtboardPhase,
  type ArtboardUserOp,
  type ResolvedArtboardOp,
} from '@lobechat/types';

import { nextArtboardId } from './ids';

export type ArtboardOpErrorCode =
  'group_not_empty' | 'invalid' | 'journey_exists' | 'locked' | 'not_found';

export class ArtboardOpError extends Error {
  constructor(
    public code: ArtboardOpErrorCode,
    message: string,
    public opIndex?: number,
  ) {
    super(message);
  }
}

export interface ArtboardApplyOptions {
  phase: ArtboardPhase;
}

export interface ArtboardApplyResult {
  changedIds: string[];
  content: ArtboardContent;
}

const fail = (code: ArtboardOpErrorCode, message: string): never => {
  throw new ArtboardOpError(code, message);
};

class Draft {
  readonly changed: string[] = [];

  constructor(
    readonly content: ArtboardContent,
    private phase: ArtboardPhase,
  ) {}

  touch(id: string) {
    if (!this.changed.includes(id)) this.changed.push(id);
  }

  group(id: string) {
    return this.content.groups.find((g) => g.id === id) ?? fail('not_found', `No group ${id}`);
  }

  frame(id: string) {
    return this.content.frames.find((f) => f.id === id) ?? fail('not_found', `No frame ${id}`);
  }

  note(id: string) {
    return this.content.notes.find((n) => n.id === id) ?? fail('not_found', `No note ${id}`);
  }

  journeyId() {
    return this.content.groups.find((g) => g.kind === 'journey')?.id;
  }

  inJourney(frame: Pick<ArtboardFrame, 'groupId'>) {
    return frame.groupId === this.journeyId();
  }

  assertJourneyOpen(what: string) {
    if (this.phase === 'finalized')
      fail('locked', `The journey is finalized; ${what} can no longer change`);
  }

  assertNoOtherJourney(exceptId?: string) {
    if (this.content.groups.some((g) => g.kind === 'journey' && g.id !== exceptId))
      fail('journey_exists', 'The board already has a journey group');
  }
}

const POSITION_KEYS = new Set(['x', 'y']);

const COLLECTION_OF = {
  addArrow: 'arrows',
  addFrame: 'frames',
  addGroup: 'groups',
  addNote: 'notes',
} as const;

const resolveRefs = (op: ResolvedArtboardOp, refs: Map<string, string>): ResolvedArtboardOp => {
  const id = (value: string) => refs.get(value) ?? value;
  switch (op.type) {
    case 'addFrame': {
      return { ...op, frame: { ...op.frame, groupId: id(op.frame.groupId) } };
    }
    case 'updateFrame': {
      const patch = op.patch.groupId ? { ...op.patch, groupId: id(op.patch.groupId) } : op.patch;
      return { ...op, id: id(op.id), patch };
    }
    case 'addArrow': {
      return { ...op, arrow: { ...op.arrow, from: id(op.arrow.from), to: id(op.arrow.to) } };
    }
    case 'setCheck': {
      return { ...op, frameId: id(op.frameId) };
    }
    case 'decideQuestion': {
      return { ...op, noteId: id(op.noteId) };
    }
    case 'addGroup':
    case 'addNote': {
      return op;
    }
    default: {
      return { ...op, id: id(op.id) };
    }
  }
};

const applyAgentOpWithRefs =
  (refs: Map<string, string>) => (draft: Draft, op: ResolvedArtboardOp) => {
    const ref = 'ref' in op ? op.ref : undefined;
    if (ref && refs.has(ref)) fail('invalid', `ref "${ref}" is used twice in this batch`);
    applyAgentOp(draft, resolveRefs(op, refs));
    if (ref && op.type in COLLECTION_OF) {
      const created = draft.content[COLLECTION_OF[op.type as keyof typeof COLLECTION_OF]].at(-1);
      if (created) refs.set(ref, created.id);
    }
  };

const applyAgentOp = (draft: Draft, op: ResolvedArtboardOp) => {
  const { content } = draft;
  switch (op.type) {
    case 'addGroup': {
      if (op.group.kind === 'journey') draft.assertNoOtherJourney();
      const id = nextArtboardId(content, 'group');
      content.groups.push({
        desc: op.group.desc ?? '',
        id,
        kind: op.group.kind,
        title: op.group.title,
      });
      draft.touch(id);
      return;
    }
    case 'updateGroup': {
      const group = draft.group(op.id);
      if (op.patch.kind && op.patch.kind !== group.kind) {
        if (op.patch.kind === 'journey') draft.assertNoOtherJourney(group.id);
        if (group.kind === 'journey' || op.patch.kind === 'journey')
          draft.assertJourneyOpen('the journey group');
      }
      Object.assign(group, op.patch);
      draft.touch(group.id);
      return;
    }
    case 'removeGroup': {
      const group = draft.group(op.id);
      if (content.frames.some((f) => f.groupId === group.id))
        fail('group_not_empty', `Group ${group.id} still has frames; remove or move them first`);
      if (group.kind === 'journey') draft.assertJourneyOpen('the journey group');
      content.groups = content.groups.filter((g) => g.id !== group.id);
      draft.touch(group.id);
      return;
    }
    case 'addFrame': {
      draft.group(op.frame.groupId);
      if (draft.inJourney(op.frame)) draft.assertJourneyOpen('journey frames');
      if (op.frame.check && !draft.inJourney(op.frame))
        fail('invalid', 'Only journey frames carry an acceptance check');
      const id = nextArtboardId(content, 'frame');
      content.frames.push({ ...op.frame, id });
      draft.touch(id);
      return;
    }
    case 'updateFrame': {
      const frame = draft.frame(op.id);
      const onlyPosition = Object.keys(op.patch).every((key) => POSITION_KEYS.has(key));
      if (op.patch.groupId) draft.group(op.patch.groupId);
      const touchesJourney =
        draft.inJourney(frame) ||
        (op.patch.groupId && draft.inJourney({ groupId: op.patch.groupId }));
      if (touchesJourney && !onlyPosition) draft.assertJourneyOpen('journey frames');
      Object.assign(frame, op.patch);
      if (frame.check && !draft.inJourney(frame)) delete frame.check;
      draft.touch(frame.id);
      return;
    }
    case 'removeFrame': {
      const frame = draft.frame(op.id);
      if (draft.inJourney(frame)) draft.assertJourneyOpen('journey frames');
      content.frames = content.frames.filter((f) => f.id !== frame.id);
      draft.touch(frame.id);
      for (const arrow of content.arrows)
        if (arrow.from === frame.id || arrow.to === frame.id) draft.touch(arrow.id);
      content.arrows = content.arrows.filter((a) => a.from !== frame.id && a.to !== frame.id);
      return;
    }
    case 'addArrow': {
      const from = draft.frame(op.arrow.from);
      const to = draft.frame(op.arrow.to);
      if (from.id === to.id) fail('invalid', 'An arrow needs two different frames');
      if (draft.inJourney(from) || draft.inJourney(to)) draft.assertJourneyOpen('journey arrows');
      const id = nextArtboardId(content, 'arrow');
      content.arrows.push({ ...op.arrow, id });
      draft.touch(id);
      return;
    }
    case 'removeArrow': {
      const arrow =
        content.arrows.find((a) => a.id === op.id) ?? fail('not_found', `No arrow ${op.id}`);
      if (draft.inJourney(draft.frame(arrow.from)) || draft.inJourney(draft.frame(arrow.to)))
        draft.assertJourneyOpen('journey arrows');
      content.arrows = content.arrows.filter((a) => a.id !== arrow.id);
      draft.touch(arrow.id);
      return;
    }
    case 'addNote': {
      const { question, ...note } = op.note;
      if (question && note.kind !== 'sticky')
        fail('invalid', 'Only a sticky note can ask a question');
      const id = nextArtboardId(content, 'note');
      content.notes.push({
        ...note,
        id,
        ...(question ? { question: { status: 'open', ...question } } : {}),
      });
      draft.touch(id);
      return;
    }
    case 'updateNote': {
      const note = draft.note(op.id);
      const { question, ...rest } = op.patch;
      Object.assign(note, rest);
      if (question === null) delete note.question;
      else if (question) {
        if (note.kind !== 'sticky') fail('invalid', 'Only a sticky note can ask a question');
        note.question = { status: 'open', ...question };
      }
      draft.touch(note.id);
      return;
    }
    case 'removeNote': {
      const note = draft.note(op.id);
      content.notes = content.notes.filter((n) => n.id !== note.id);
      draft.touch(note.id);
      return;
    }
    case 'setCheck': {
      const frame = draft.frame(op.frameId);
      if (!draft.inJourney(frame)) fail('invalid', 'Only journey frames carry an acceptance check');
      draft.assertJourneyOpen('acceptance checks');
      frame.check = { expected: op.expected };
      draft.touch(frame.id);
      return;
    }
    case 'decideQuestion': {
      decide(draft, op.noteId, op.decision);
    }
  }
};

const decide = (draft: Draft, noteId: string, decision: string) => {
  const note = draft.note(noteId);
  if (!note.question) fail('invalid', `Note ${noteId} has no question to decide`);
  note.question = { ...note.question, decision, status: 'decided' };
  draft.touch(note.id);
};

const applyUserOp = (draft: Draft, op: ArtboardUserOp) => {
  switch (op.type) {
    case 'moveItem': {
      const item =
        draft.content.frames.find((f) => f.id === op.id) ??
        draft.content.notes.find((n) => n.id === op.id) ??
        fail('not_found', `Nothing movable with id ${op.id}`);
      item.x = op.x;
      item.y = op.y;
      draft.touch(item.id);
      return;
    }
    case 'decideQuestion': {
      decide(draft, op.noteId, op.decision);
      return;
    }
    case 'updateNoteText': {
      const note = draft.note(op.id);
      note.text = op.text;
      draft.touch(note.id);
    }
  }
};

const run = <Op>(
  content: ArtboardContent,
  ops: Op[],
  options: ArtboardApplyOptions,
  apply: (draft: Draft, op: Op) => void,
): ArtboardApplyResult => {
  const draft = new Draft(structuredClone(content), options.phase);
  ops.forEach((op, index) => {
    try {
      apply(draft, op);
    } catch (error) {
      if (error instanceof ArtboardOpError)
        throw new ArtboardOpError(error.code, error.message, index);
      throw error;
    }
  });
  const parsed = artboardContentSchema.safeParse(draft.content);
  if (!parsed.success) fail('invalid', parsed.error.issues.map((i) => i.message).join('; '));
  return { changedIds: draft.changed, content: draft.content };
};

export const applyArtboardOps = (
  content: ArtboardContent,
  ops: ResolvedArtboardOp[],
  options: ArtboardApplyOptions,
) => run(content, ops, options, applyAgentOpWithRefs(new Map()));

export const applyArtboardUserOps = (
  content: ArtboardContent,
  ops: ArtboardUserOp[],
  options: ArtboardApplyOptions,
) => run(content, ops, options, applyUserOp);
