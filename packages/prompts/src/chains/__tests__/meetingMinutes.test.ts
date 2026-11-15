import { describe, expect, it } from 'vitest';

import {
  chainMeetingMinutes,
  formatMeetingTranscriptLine,
  MEETING_MINUTES_JSON_SCHEMA,
  MEETING_MINUTES_PROMPT_VERSION,
} from '../meetingMinutes';

const input = {
  assigneeNames: ['Alice Chen', 'Research Agent'],
  language: 'zh',
  meetingDate: '2026-10-20 (Tuesday)',
  recorderName: 'Bob',
  title: '周会',
  transcript: [
    { index: 0, speaker: 'Alice Chen', startMs: 0, text: '我们下周三上线。' },
    { index: 1, startMs: 3_725_000, text: '好的。' },
  ],
};

describe('chainMeetingMinutes', () => {
  it('keeps the version and the schema contract together', () => {
    expect(MEETING_MINUTES_PROMPT_VERSION).toBe('v1');
    expect(MEETING_MINUTES_JSON_SCHEMA.name).toBe('meeting_minutes');
    expect(MEETING_MINUTES_JSON_SCHEMA.strict).toBe(true);

    const { properties, required } = MEETING_MINUTES_JSON_SCHEMA.schema;
    expect(required).toEqual(['summary', 'chapters', 'decisions', 'actionItems', 'keywords']);
    // Strict mode needs every field required; "none" is expressed as "" rather than omitted.
    expect(properties.actionItems.items.required).toEqual([
      'text',
      'assignee',
      'dueDate',
      'segmentIndexes',
    ]);
    expect(properties.chapters.items.required).toEqual(['title', 'startIndex', 'endIndex']);
  });

  it('numbers transcript lines with offset and speaker so items can cite them', () => {
    expect(formatMeetingTranscriptLine(input.transcript[0])).toBe(
      '[#0 00:00 Alice Chen] 我们下周三上线。',
    );
    // Past the first hour the offset carries hours, and an unknown speaker is omitted.
    expect(formatMeetingTranscriptLine(input.transcript[1])).toBe('[#1 1:02:05] 好的。');
  });

  it('anchors relative deadlines, owners and language in the prompt', () => {
    const { messages } = chainMeetingMinutes(input);
    const [system, user] = messages;

    expect(system.content).toContain('against the meeting date 2026-10-20 (Tuesday)');
    expect(system.content).toContain('Never invent a decision, an owner, a deadline');
    expect(system.content).toContain('cites in segmentIndexes');
    expect(system.content).toContain('language the meeting was held in (zh)');

    expect(user.content).toContain('## Meeting\n周会\nDate: 2026-10-20 (Tuesday)');
    expect(user.content).toContain('Recorder: Bob');
    expect(user.content).toContain('## Assignee list\n- Alice Chen\n- Research Agent');
    expect(user.content).toContain('[#0 00:00 Alice Chen] 我们下周三上线。');
  });

  it('omits the assignee list and language when unknown', () => {
    const { messages } = chainMeetingMinutes({
      ...input,
      assigneeNames: [],
      language: 'auto',
      recorderName: undefined,
    });

    expect(messages[0].content).toContain('language the meeting was held in.');
    expect(messages[1].content).not.toContain('## Assignee list');
    expect(messages[1].content).not.toContain('Recorder:');
  });
});
