import type { ArtboardRoundView } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { submitBoardRounds, summarizeRounds } from './submitRounds';

const mocks = vi.hoisted(() => ({
  mutateArtboard: vi.fn(),
  mutateArtboardComments: vi.fn(),
  send: vi.fn(),
  submitRounds: vi.fn(),
}));

vi.mock('@/services/artboard', () => ({
  artboardService: { submitRounds: mocks.submitRounds },
}));
vi.mock('./boardConversation', () => ({ sendToBoardConversation: mocks.send }));
vi.mock('./useArtboard', () => ({ mutateArtboard: mocks.mutateArtboard }));
vi.mock('./useArtboardComments', () => ({
  mutateArtboardComments: mocks.mutateArtboardComments,
}));

const round = (id: string, patch: Partial<ArtboardRoundView> = {}): ArtboardRoundView => ({
  batchId: null,
  chosenBoardId: null,
  id,
  pageId: 'p1',
  recommendedBoardId: null,
  status: 'open',
  title: id,
  ...patch,
});

const artboard = { id: 'art_1', topicId: 'tpc_1' };
const message = (count: number) => `submitted ${count}`;

describe('summarizeRounds', () => {
  it('counts picks, recommendations that will apply, and rounds with neither', () => {
    expect(
      summarizeRounds([
        round('r1', { chosenBoardId: 'a', recommendedBoardId: 'b' }),
        round('r2', { recommendedBoardId: 'c' }),
        round('r3'),
        round('r4'),
      ]),
    ).toEqual({ byRecommendation: 1, firstUndecidedId: 'r3', picked: 1, total: 4, undecided: 2 });
  });
});

describe('submitBoardRounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitRounds.mockResolvedValue({ artboard: {}, submitted: 2 });
    mocks.send.mockResolvedValue('sent');
  });

  it('submits, refreshes the board and sends one message to its conversation', async () => {
    expect(await submitBoardRounds(artboard, message)).toEqual({
      message: 'submitted 2',
      status: 'sent',
    });
    expect(mocks.submitRounds).toHaveBeenCalledWith('art_1');
    expect(mocks.mutateArtboard).toHaveBeenCalledWith('art_1');
    expect(mocks.send).toHaveBeenCalledWith('tpc_1', 'submitted 2');
  });

  it('still submits when the board has no conversation', async () => {
    mocks.send.mockResolvedValue('noConversation');

    expect((await submitBoardRounds(artboard, message)).status).toBe('noConversation');
  });

  it('reports a message that failed after the choices were saved', async () => {
    mocks.send.mockRejectedValue(new Error('offline'));

    expect(await submitBoardRounds(artboard, message)).toEqual({
      message: 'submitted 2',
      status: 'messageFailed',
    });
  });

  it('sends nothing when the submit is refused or nothing was open', async () => {
    mocks.submitRounds.mockRejectedValueOnce(new Error('missing choice'));
    await expect(submitBoardRounds(artboard, message)).rejects.toThrow('missing choice');
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.submitRounds.mockResolvedValue({ artboard: {}, submitted: 0 });
    expect((await submitBoardRounds(artboard, message)).status).toBe('nothing');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
