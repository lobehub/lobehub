// @vitest-environment node
import type { AcceptanceFrameBoardInput } from '@lobechat/types';
import { getAcceptanceFrameStage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceModel } from '../acceptance';
import {
  AcceptanceFrameBoardError,
  AcceptanceFrameBoardModel,
  applyAcceptanceFrameOperation,
  publishAcceptanceFrameBoard,
} from '../acceptanceFrameBoard';

const NOW = '2026-10-23T00:00:00.000Z';

const input: AcceptanceFrameBoardInput = {
  frames: [
    {
      key: 'empty',
      title: 'Empty',
      versions: [
        { canvasId: 'cvs-setup', canvasVersion: 1, label: 'A', page: 'empty-a.html' },
        { canvasId: 'cvs-setup', canvasVersion: 1, label: 'B', page: 'empty-b.html' },
      ],
    },
    {
      key: 'sources',
      title: 'Sources',
      versions: [{ canvasId: 'cvs-setup', canvasVersion: 1, label: 'A', page: 'sources.html' }],
    },
  ],
  title: 'Setup panel',
  transitions: [{ from: 'empty', to: 'sources', trigger: 'Click "Connect"' }],
};

const criteria = { copy: ['Connect sources'], edgeCases: ['No repos'], states: ['current'] };

const lockedBoard = () => {
  let board = publishAcceptanceFrameBoard(undefined, input, NOW);
  const frame = board.frames[0];
  board = applyAcceptanceFrameOperation(
    board,
    frame.id,
    { type: 'selectVersion', versionId: frame.versions[1].id },
    'reviewer',
    NOW,
  );
  board = applyAcceptanceFrameOperation(
    board,
    frame.id,
    { criteria, type: 'setCriteria' },
    'reviewer',
    NOW,
  );
  return applyAcceptanceFrameOperation(board, frame.id, { type: 'lockBaseline' }, 'reviewer', NOW);
};

describe('publishAcceptanceFrameBoard', () => {
  it('labels every version mock and resolves transitions by frame key', () => {
    const board = publishAcceptanceFrameBoard(undefined, input, NOW);
    expect(board.version).toBe(1);
    expect(board.frames.flatMap((frame) => frame.versions.map((v) => v.source))).toEqual([
      'mock',
      'mock',
      'mock',
    ]);
    expect(board.transitions).toEqual([
      expect.objectContaining({
        fromFrameId: board.frames[0].id,
        toFrameId: board.frames[1].id,
        trigger: 'Click "Connect"',
      }),
    ]);
  });

  it('rejects unknown transition keys and duplicate frame keys', () => {
    expect(() =>
      publishAcceptanceFrameBoard(
        undefined,
        { ...input, transitions: [{ from: 'empty', to: 'goal', trigger: 'x' }] },
        NOW,
      ),
    ).toThrow(AcceptanceFrameBoardError);
    expect(() =>
      publishAcceptanceFrameBoard(
        undefined,
        { ...input, frames: [input.frames[0], input.frames[0]] },
        NOW,
      ),
    ).toThrow('Duplicate frame key');
  });

  it('keeps the review of a surviving frame, including its baseline Canvas page, on republish', () => {
    const locked = lockedBoard();
    const republished = publishAcceptanceFrameBoard(
      locked,
      {
        ...input,
        frames: [
          {
            ...input.frames[0],
            versions: [{ canvasId: 'cvs-setup', canvasVersion: 2, label: 'C', page: 'empty.html' }],
          },
          input.frames[1],
        ],
      },
      NOW,
    );
    const frame = republished.frames[0];
    expect(frame.id).toBe(locked.frames[0].id);
    expect(frame.baseline).toEqual(locked.frames[0].baseline);
    expect(frame.versions.map(({ canvasVersion, page }) => `${canvasVersion}:${page}`)).toEqual([
      '2:empty.html',
      '1:empty-b.html',
    ]);
    expect(republished.version).toBe(locked.version + 1);
  });

  it('keeps a version id only while it names the same page of the same Canvas version', () => {
    const first = publishAcceptanceFrameBoard(undefined, input, NOW);
    const [a, b] = first.frames[0].versions;
    const republished = publishAcceptanceFrameBoard(
      first,
      {
        ...input,
        frames: [
          {
            ...input.frames[0],
            versions: [
              { canvasId: 'cvs-setup', canvasVersion: 1, label: 'A2', page: 'empty-a.html' },
              { canvasId: 'cvs-setup', canvasVersion: 2, label: 'B', page: 'empty-b.html' },
            ],
          },
          input.frames[1],
        ],
      },
      NOW,
    );
    const [keptA, bumpedB] = republished.frames[0].versions;
    expect(keptA).toMatchObject({ id: a.id, label: 'A2' });
    expect(bumpedB.id).not.toBe(b.id);
  });
});

describe('applyAcceptanceFrameOperation', () => {
  it('refuses to lock without a chosen version or complete acceptance points', () => {
    const board = publishAcceptanceFrameBoard(undefined, input, NOW);
    const frame = board.frames[0];
    expect(() =>
      applyAcceptanceFrameOperation(board, frame.id, { type: 'lockBaseline' }, null, NOW),
    ).toThrow('Choose a version');
    const chosen = applyAcceptanceFrameOperation(
      board,
      frame.id,
      { type: 'selectVersion', versionId: frame.versions[0].id },
      null,
      NOW,
    );
    const partial = applyAcceptanceFrameOperation(
      chosen,
      frame.id,
      { criteria: { ...criteria, copy: [] }, type: 'setCriteria' },
      null,
      NOW,
    );
    expect(() =>
      applyAcceptanceFrameOperation(partial, frame.id, { type: 'lockBaseline' }, null, NOW),
    ).toThrow('States, edge cases and copy');
  });

  it('freezes the chosen version and criteria, and blocks edits until reopened', () => {
    const board = lockedBoard();
    const frame = board.frames[0];
    expect(frame.baseline).toEqual({
      criteria,
      lockedAt: NOW,
      lockedBy: 'reviewer',
      versionId: frame.versions[1].id,
    });
    expect(getAcceptanceFrameStage(frame)).toBe('baselined');
    expect(() =>
      applyAcceptanceFrameOperation(
        board,
        frame.id,
        { type: 'selectVersion', versionId: frame.versions[0].id },
        null,
        NOW,
      ),
    ).toThrow('Unlock the baseline');
    expect(() =>
      applyAcceptanceFrameOperation(board, frame.id, { criteria, type: 'setCriteria' }, null, NOW),
    ).toThrow('Unlock the baseline');
  });

  it('keeps delivery apart from review: a locked prototype is not a delivery pass', () => {
    const unlocked = publishAcceptanceFrameBoard(undefined, input, NOW);
    expect(() =>
      applyAcceptanceFrameOperation(
        unlocked,
        unlocked.frames[0].id,
        { fileId: 'real-1', type: 'addCapture' },
        null,
        NOW,
      ),
    ).toThrow('Lock a baseline');

    let board = lockedBoard();
    const frameId = board.frames[0].id;
    expect(() =>
      applyAcceptanceFrameOperation(
        board,
        frameId,
        { type: 'reviewReal', verdict: 'matches' },
        null,
        NOW,
      ),
    ).toThrow('Attach a real capture');

    board = applyAcceptanceFrameOperation(
      board,
      frameId,
      { fileId: 'real-1', type: 'addCapture' },
      'qa',
      NOW,
    );
    expect(board.frames[0].captures[0]).toMatchObject({ fileId: 'real-1', source: 'real' });
    expect(getAcceptanceFrameStage(board.frames[0])).toBe('awaitingRealReview');

    board = applyAcceptanceFrameOperation(
      board,
      frameId,
      { type: 'reviewReal', verdict: 'deviates' },
      'qa',
      NOW,
    );
    expect(getAcceptanceFrameStage(board.frames[0])).toBe('realDeviates');

    // A newer capture is not covered by the verdict on the older one.
    board = applyAcceptanceFrameOperation(
      board,
      frameId,
      { fileId: 'real-2', type: 'addCapture' },
      'qa',
      NOW,
    );
    expect(getAcceptanceFrameStage(board.frames[0])).toBe('awaitingRealReview');

    // Reopening the review voids the delivery verdict but keeps the observations.
    board = applyAcceptanceFrameOperation(board, frameId, { type: 'unlockBaseline' }, 'qa', NOW);
    expect(board.frames[0].realReview).toBeNull();
    expect(board.frames[0].captures).toHaveLength(2);
    expect(getAcceptanceFrameStage(board.frames[0])).toBe('reviewing');
  });
});

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'frame-board-user';
const topicId = 'frame-board-topic';

describe('AcceptanceFrameBoardModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }]);
    await serverDB.insert(topics).values([{ id: topicId, userId }]);
  });

  afterEach(async () => {
    await serverDB.delete(acceptances);
    await serverDB.delete(topics);
    await serverDB.delete(users);
  });

  it('stores the board beside other metadata and refuses stale writes', async () => {
    const acceptance = await new AcceptanceModel(serverDB, userId).create({
      metadata: { title: 'Keep me' },
      subjectId: topicId,
      subjectType: 'topic',
    });
    const model = new AcceptanceFrameBoardModel(serverDB);

    const published = await model.publish(acceptance.id, input, 0);
    expect(published.version).toBe(1);
    await expect(model.publish(acceptance.id, input, 0)).rejects.toThrow('changed; reload');

    const frame = published.frames[0];
    const chosen = await model.apply(
      acceptance.id,
      frame.id,
      { type: 'selectVersion', versionId: frame.versions[0].id },
      userId,
      1,
    );
    expect(chosen.frames[0].selectedVersionId).toBe(frame.versions[0].id);

    const stored = await new AcceptanceModel(serverDB, userId).findById(acceptance.id);
    expect(stored?.metadata?.title).toBe('Keep me');
    expect(await model.get(acceptance.id)).toEqual(chosen);
  });
});
