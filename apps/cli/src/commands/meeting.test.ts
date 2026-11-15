import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerMeetingCommand } from './meeting';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    meeting: {
      detail: { query: vi.fn() },
      list: { query: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));

const meetingRow = {
  durationMs: 65_000,
  id: 'meeting-1',
  language: 'zh',
  startedAt: new Date('2026-11-08T10:00:00Z').toISOString(),
  status: 'ready',
  title: 'Weekly sync',
};

const output = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');

describe('meeting command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(log, 'error').mockImplementation(() => {});
    mockTrpcClient.meeting.list.query.mockReset();
    mockTrpcClient.meeting.detail.query.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerMeetingCommand(program);
    return program.parseAsync(['node', 'test', 'meeting', ...args]);
  };

  describe('list', () => {
    it('passes paging and status to the API and prints a table', async () => {
      mockTrpcClient.meeting.list.query.mockResolvedValue({ data: [meetingRow], success: true });

      await run('list', '-L', '5', '--offset', '10', '--status', 'ready');

      expect(mockTrpcClient.meeting.list.query).toHaveBeenCalledWith({
        limit: 5,
        offset: 10,
        status: 'ready',
      });
      expect(output(consoleSpy)).toContain('Weekly sync');
      expect(output(consoleSpy)).toContain('1:05');
    });

    it('leaves the duration blank while a meeting has none', async () => {
      mockTrpcClient.meeting.list.query.mockResolvedValue({
        data: [{ ...meetingRow, durationMs: null }],
        success: true,
      });

      await run('list');

      expect(output(consoleSpy)).not.toContain('0:00');
    });

    it('outputs the selected JSON fields', async () => {
      mockTrpcClient.meeting.list.query.mockResolvedValue({ data: [meetingRow], success: true });

      await run('list', '--json', 'id,status');

      expect(JSON.parse(output(consoleSpy))).toEqual([{ id: 'meeting-1', status: 'ready' }]);
    });

    it('reports an empty list', async () => {
      mockTrpcClient.meeting.list.query.mockResolvedValue({ data: [], success: true });

      await run('list');

      expect(output(consoleSpy)).toContain('No meetings found.');
    });

    it.each([
      ['--limit', '101'],
      ['--limit', '1.5'],
      ['--offset', '-1'],
    ])('rejects %s %s before calling the API', async (flag, value) => {
      await run('list', `${flag}=${value}`);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockTrpcClient.meeting.list.query).not.toHaveBeenCalled();
    });

    it('rejects an unknown status', async () => {
      await expect(run('list', '--status', 'nope')).rejects.toThrow();
      expect(mockTrpcClient.meeting.list.query).not.toHaveBeenCalled();
    });
  });

  describe('view', () => {
    const detail = {
      ...meetingRow,
      audio: { url: 'https://cdn/a.webm' },
      localAudioPath: null,
      minutes: {
        actionItems: [
          { assigneeHint: 'Alice', id: 'a1', segmentIds: [], status: 'suggested', text: 'Ship it' },
        ],
        chapters: [{ endMs: 60_000, segmentIds: [], startMs: 0, title: 'Kickoff' }],
        decisions: [{ segmentIds: [], text: 'Use uuid' }],
        keywords: ['api'],
        summary: 'All good',
      },
      segmentSource: 'refine',
      segments: [
        { id: 's1', speakerId: 'sp1', startMs: 3_661_000, text: 'Hello' },
        { id: 's2', speakerId: null, startMs: 5_000, text: 'Unattributed' },
      ],
      speakers: [{ displayName: 'Alice', id: 'sp1', label: 'S1' }],
    };

    it('prints minutes and a transcript with speaker names', async () => {
      mockTrpcClient.meeting.detail.query.mockResolvedValue({ data: detail, success: true });

      await run('view', 'meeting-1', '--source', 'refine');

      expect(mockTrpcClient.meeting.detail.query).toHaveBeenCalledWith({
        id: 'meeting-1',
        source: 'refine',
      });
      const text = output(consoleSpy);
      for (const expected of [
        'Weekly sync',
        'https://cdn/a.webm',
        'All good',
        'Kickoff',
        'Use uuid',
        'Ship it',
        'Transcript (refine)',
        '1:01:01',
        'Alice',
        'Hello',
        'Unattributed',
      ]) {
        expect(text).toContain(expected);
      }
    });

    it('falls back to the diarization label and skips absent minutes', async () => {
      mockTrpcClient.meeting.detail.query.mockResolvedValue({
        data: {
          ...detail,
          audio: null,
          localAudioPath: '/tmp/a.wav',
          minutes: null,
          speakers: [{ displayName: null, id: 'sp1', label: 'S1' }],
        },
        success: true,
      });

      await run('view', 'meeting-1');

      const text = output(consoleSpy);
      expect(text).toContain('S1');
      expect(text).toContain('/tmp/a.wav');
      expect(text).not.toContain('Summary');
    });

    it('outputs JSON', async () => {
      mockTrpcClient.meeting.detail.query.mockResolvedValue({ data: detail, success: true });

      await run('view', 'meeting-1', '--json', 'id,segmentSource');

      expect(JSON.parse(output(consoleSpy))).toEqual({ id: 'meeting-1', segmentSource: 'refine' });
    });

    it('lets a server error reach the top-level handler', async () => {
      mockTrpcClient.meeting.detail.query.mockRejectedValue(new Error('Meeting not found'));

      await expect(run('view', 'missing')).rejects.toThrow('Meeting not found');
    });
  });
});
