import { describe, expect, it } from 'vitest';

import { composeVoiceTranscript } from './useApplyTranscriptToEditor';

describe('composeVoiceTranscript', () => {
  it('should use transcript directly when the input is empty', () => {
    expect(composeVoiceTranscript('', ' hello world ')).toBe('hello world');
  });

  it('should append transcript to existing input with one separating space', () => {
    expect(composeVoiceTranscript('Create a plan', 'for tomorrow')).toBe(
      'Create a plan for tomorrow',
    );
  });

  it('should preserve an existing trailing separator', () => {
    expect(composeVoiceTranscript('Create a plan ', 'for tomorrow')).toBe(
      'Create a plan for tomorrow',
    );
  });

  it('should ignore empty transcript updates', () => {
    expect(composeVoiceTranscript('Keep this draft', '   ')).toBe('Keep this draft');
  });
});
