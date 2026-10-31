import type {
  AcceptanceFrame,
  AcceptanceFrameBoard,
  AcceptanceFrameBoardInput,
  AcceptanceFrameCriteria,
  AcceptanceFrameOperation,
} from '@lobechat/types';
import { isAcceptanceFrameCriteriaComplete } from '@lobechat/types';
import { eq, sql } from 'drizzle-orm';

import { acceptances } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { createNanoId } from '../utils/idGenerator';

const frameItemId = createNanoId(12);

export type AcceptanceFrameBoardErrorCode = 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND';

export class AcceptanceFrameBoardError extends Error {
  readonly code: AcceptanceFrameBoardErrorCode;

  constructor(code: AcceptanceFrameBoardErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AcceptanceFrameBoardError';
  }
}

const EMPTY_CRITERIA: AcceptanceFrameCriteria = { copy: [], edgeCases: [], states: [] };

const fail = (code: AcceptanceFrameBoardErrorCode, message: string): never => {
  throw new AcceptanceFrameBoardError(code, message);
};

/** A version is the same reference only if it shows the same page of the same Canvas version. */
const canvasRefKey = (version: { canvasId: string; canvasVersion: number; page?: string }) =>
  `${version.canvasId}@${version.canvasVersion}#${version.page ?? ''}`;

/**
 * Lay a published definition over the stored board. A frame whose key
 * survives keeps its id, choice, baseline and real captures — republishing a
 * prototype must never quietly discard a review that already happened. A
 * locked frame also keeps its baseline version even when the new definition
 * leaves it out, because that Canvas page is what the delivery is judged against.
 */
export const publishAcceptanceFrameBoard = (
  current: AcceptanceFrameBoard | undefined,
  input: AcceptanceFrameBoardInput,
  now: string,
): AcceptanceFrameBoard => {
  const keys = new Set<string>();
  for (const frame of input.frames) {
    if (keys.has(frame.key)) fail('BAD_REQUEST', `Duplicate frame key "${frame.key}"`);
    keys.add(frame.key);
  }

  const previousByKey = new Map((current?.frames ?? []).map((frame) => [frame.key, frame]));
  const frames = input.frames.map((definition): AcceptanceFrame => {
    const previous = previousByKey.get(definition.key);
    const previousVersions = new Map(
      (previous?.versions ?? []).map((version) => [canvasRefKey(version), version]),
    );
    const versions = definition.versions.map((version) => {
      const kept = previousVersions.get(canvasRefKey(version));
      return {
        canvasId: version.canvasId,
        canvasVersion: version.canvasVersion,
        createdAt: kept?.createdAt ?? now,
        id: kept?.id ?? frameItemId(),
        label: version.label,
        ...(version.note ? { note: version.note } : {}),
        ...(version.page ? { page: version.page } : {}),
        source: 'mock' as const,
      };
    });
    const baselineVersion = previous?.baseline
      ? previous.versions.find((version) => version.id === previous.baseline!.versionId)
      : undefined;
    if (baselineVersion && !versions.some((version) => version.id === baselineVersion.id))
      versions.push(baselineVersion);

    const selectedVersionId =
      previous?.selectedVersionId &&
      versions.some((version) => version.id === previous.selectedVersionId)
        ? previous.selectedVersionId
        : null;
    const criteria =
      previous?.baseline || !definition.criteria
        ? (previous?.criteria ?? EMPTY_CRITERIA)
        : { ...EMPTY_CRITERIA, ...previous?.criteria, ...definition.criteria };

    return {
      baseline: previous?.baseline ?? null,
      captures: previous?.captures ?? [],
      criteria,
      ...(definition.description ? { description: definition.description } : {}),
      id: previous?.id ?? frameItemId(),
      key: definition.key,
      realReview: previous?.realReview ?? null,
      selectedVersionId,
      title: definition.title,
      versions,
    };
  });

  const idByKey = new Map(frames.map((frame) => [frame.key, frame.id]));
  const previousTransitions = new Map(
    (current?.transitions ?? []).map((transition) => [
      `${transition.fromFrameId}>${transition.toFrameId}`,
      transition.id,
    ]),
  );
  const transitions = input.transitions.map((transition) => {
    const fromFrameId = idByKey.get(transition.from);
    const toFrameId = idByKey.get(transition.to);
    if (!fromFrameId || !toFrameId)
      fail(
        'BAD_REQUEST',
        `Transition ${transition.from} → ${transition.to} names an unknown frame`,
      );
    return {
      fromFrameId: fromFrameId!,
      id: previousTransitions.get(`${fromFrameId}>${toFrameId}`) ?? frameItemId(),
      toFrameId: toFrameId!,
      trigger: transition.trigger,
    };
  });

  return {
    ...(input.description ? { description: input.description } : {}),
    frames,
    title: input.title,
    transitions,
    updatedAt: now,
    version: (current?.version ?? 0) + 1,
  };
};

/**
 * One review or delivery action on one frame. The two phases stay apart: the
 * design review ends when the baseline is locked, and only a locked node can
 * receive a real capture or a delivery verdict.
 */
export const applyAcceptanceFrameOperation = (
  board: AcceptanceFrameBoard,
  frameId: string,
  operation: AcceptanceFrameOperation,
  actorId: string | null,
  now: string,
): AcceptanceFrameBoard => {
  const index = board.frames.findIndex((frame) => frame.id === frameId);
  if (index === -1) fail('NOT_FOUND', 'Frame not found');
  const frame = board.frames[index];
  const locked = Boolean(frame.baseline);
  let next: AcceptanceFrame;

  switch (operation.type) {
    case 'selectVersion': {
      if (locked) fail('BAD_REQUEST', 'Unlock the baseline before choosing another version');
      if (!frame.versions.some((version) => version.id === operation.versionId))
        fail('NOT_FOUND', 'Version not found');
      next = { ...frame, selectedVersionId: operation.versionId };
      break;
    }
    case 'setCriteria': {
      if (locked) fail('BAD_REQUEST', 'Unlock the baseline before editing its acceptance points');
      next = { ...frame, criteria: operation.criteria };
      break;
    }
    case 'lockBaseline': {
      if (locked) fail('BAD_REQUEST', 'The baseline is already locked');
      if (!frame.selectedVersionId) fail('BAD_REQUEST', 'Choose a version before locking');
      if (!isAcceptanceFrameCriteriaComplete(frame.criteria))
        fail('BAD_REQUEST', 'States, edge cases and copy all need at least one acceptance point');
      next = {
        ...frame,
        baseline: {
          criteria: frame.criteria,
          lockedAt: now,
          lockedBy: actorId,
          versionId: frame.selectedVersionId!,
        },
      };
      break;
    }
    case 'unlockBaseline': {
      if (!locked) fail('BAD_REQUEST', 'The baseline is not locked');
      // A verdict judged the capture against this baseline; reopening the
      // review voids it, while the captures themselves stay as observations.
      next = { ...frame, baseline: null, realReview: null };
      break;
    }
    case 'addCapture': {
      if (!locked) fail('BAD_REQUEST', 'Lock a baseline before attaching a real capture');
      next = {
        ...frame,
        captures: [
          ...frame.captures,
          {
            addedBy: actorId,
            capturedAt: now,
            fileId: operation.fileId,
            id: frameItemId(),
            ...(operation.note ? { note: operation.note } : {}),
            source: 'real',
          },
        ],
      };
      break;
    }
    case 'removeCapture': {
      if (!frame.captures.some((capture) => capture.id === operation.captureId))
        fail('NOT_FOUND', 'Capture not found');
      next = {
        ...frame,
        captures: frame.captures.filter((capture) => capture.id !== operation.captureId),
        realReview:
          frame.realReview?.captureId === operation.captureId ? null : (frame.realReview ?? null),
      };
      break;
    }
    case 'reviewReal': {
      if (!locked) fail('BAD_REQUEST', 'Lock a baseline before judging the real capture');
      const capture = frame.captures.at(-1);
      if (!capture) fail('BAD_REQUEST', 'Attach a real capture before judging it');
      next = {
        ...frame,
        realReview: {
          captureId: capture!.id,
          ...(operation.note ? { note: operation.note } : {}),
          reviewedAt: now,
          reviewedBy: actorId,
          verdict: operation.verdict,
        },
      };
      break;
    }
    case 'clearRealReview': {
      next = { ...frame, realReview: null };
      break;
    }
  }

  const frames = [...board.frames];
  frames[index] = next!;
  return { ...board, frames, updatedAt: now, version: board.version + 1 };
};

/**
 * The frames board lives in `acceptances.metadata.frameBoard`. Authorization is
 * the router's job (the same write rule as every acceptance mutation); the
 * model guarantees that concurrent writers serialize on the row and that a
 * stale `expectedVersion` is refused instead of overwriting someone's review.
 */
export class AcceptanceFrameBoardModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  get = async (acceptanceId: string): Promise<AcceptanceFrameBoard | null> => {
    const row = await this.db.query.acceptances.findFirst({
      columns: { metadata: true },
      where: eq(acceptances.id, acceptanceId),
    });
    return row?.metadata?.frameBoard ?? null;
  };

  publish = (acceptanceId: string, input: AcceptanceFrameBoardInput, expectedVersion?: number) =>
    this.write(acceptanceId, expectedVersion, (current, now) =>
      publishAcceptanceFrameBoard(current, input, now),
    );

  apply = (
    acceptanceId: string,
    frameId: string,
    operation: AcceptanceFrameOperation,
    actorId: string | null,
    expectedVersion?: number,
  ) =>
    this.write(acceptanceId, expectedVersion, (current, now) => {
      if (!current) return fail('NOT_FOUND', 'This acceptance has no frames board');
      return applyAcceptanceFrameOperation(current, frameId, operation, actorId, now);
    });

  private write = (
    acceptanceId: string,
    expectedVersion: number | undefined,
    produce: (current: AcceptanceFrameBoard | undefined, now: string) => AcceptanceFrameBoard,
  ) =>
    this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: acceptances.metadata })
        .from(acceptances)
        .where(eq(acceptances.id, acceptanceId))
        .for('update');
      if (!row) fail('NOT_FOUND', 'Acceptance not found');
      const current = row.metadata?.frameBoard;
      if (expectedVersion !== undefined && (current?.version ?? 0) !== expectedVersion)
        fail('CONFLICT', 'The frames board changed; reload before editing');

      const board = produce(current, new Date().toISOString());
      // Only this key is written: title, grouping and linked PRs belong to
      // other writers and must survive untouched.
      await tx
        .update(acceptances)
        .set({
          metadata: sql`COALESCE(${acceptances.metadata}, '{}'::jsonb) || ${JSON.stringify({ frameBoard: board })}::jsonb`,
        })
        .where(eq(acceptances.id, acceptanceId));
      return board;
    });
}
