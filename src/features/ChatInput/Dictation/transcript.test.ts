import { describe, expect, it } from 'vitest';

import type { RealtimeAsrTranscriptEvent } from './contract';
import { DictationTranscript } from './transcript';

const event = (
  sequence: number,
  type: RealtimeAsrTranscriptEvent['type'],
  text: string,
  segmentId = 'segment-1',
  sessionId = 'session-1',
): RealtimeAsrTranscriptEvent => ({ segmentId, sequence, sessionId, text, type });

describe('DictationTranscript', () => {
  it('replaces partial text and commits final text without touching prefix or suffix', () => {
    const transcript = new DictationTranscript({
      anchor: 6,
      prefix: 'hello ',
      sessionId: 'session-1',
      suffix: ' world',
    });

    transcript.accept(event(1, 'transcript.partial', '你'));
    transcript.accept(event(2, 'transcript.partial', '你好'));
    transcript.accept(event(3, 'transcript.final', '你好'));

    expect(transcript.snapshot).toMatchObject({
      committed: '你好',
      partial: '',
      prefix: 'hello ',
      suffix: ' world',
      text: 'hello 你好 world',
    });
  });

  it('ignores old sessions, duplicate sequence numbers, and out-of-order events', () => {
    const transcript = new DictationTranscript({
      anchor: 0,
      prefix: '',
      sessionId: 'session-1',
      suffix: '',
    });

    expect(
      transcript.accept(event(1, 'transcript.partial', 'old', 'segment-1', 'session-old')),
    ).toMatchObject({ accepted: false });
    expect(transcript.accept(event(2, 'transcript.partial', 'new'))).toMatchObject({
      accepted: true,
    });
    expect(transcript.accept(event(2, 'transcript.partial', 'duplicate'))).toMatchObject({
      accepted: false,
    });
    expect(transcript.accept(event(1, 'transcript.final', 'out-of-order'))).toMatchObject({
      accepted: false,
    });
    expect(transcript.dictatedText).toBe('new');
  });

  it('rejects a new segment until the active segment is finalized and deduplicates finals', () => {
    const transcript = new DictationTranscript({
      anchor: 0,
      prefix: '',
      sessionId: 'session-1',
      suffix: '',
    });

    transcript.accept(event(1, 'transcript.partial', 'one'));
    expect(transcript.accept(event(2, 'transcript.partial', 'two', 'segment-2'))).toMatchObject({
      accepted: false,
    });
    transcript.accept(event(3, 'transcript.final', 'one'));
    expect(transcript.accept(event(4, 'transcript.final', 'one again'))).toMatchObject({
      accepted: false,
    });
    transcript.accept(event(5, 'transcript.final', 'two', 'segment-2'));
    expect(transcript.dictatedText).toBe('onetwo');
  });

  it('drops only the unconfirmed partial on cancel', () => {
    const transcript = new DictationTranscript({
      anchor: 0,
      prefix: '',
      sessionId: 'session-1',
      suffix: '',
    });
    transcript.accept(event(1, 'transcript.final', 'confirmed'));
    transcript.accept(event(2, 'transcript.partial', 'temporary', 'segment-2'));

    transcript.discardPartial();

    expect(transcript.snapshot).toMatchObject({ committed: 'confirmed', partial: '' });
  });
});
