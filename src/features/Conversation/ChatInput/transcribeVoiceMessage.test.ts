import { afterEach, describe, expect, it, vi } from 'vitest';

import { asrService } from '@/services/asr';

import { transcribeVoiceMessage } from './transcribeVoiceMessage';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transcribeVoiceMessage', () => {
  it('transcribes the uploaded recording by file id with the configured STT model', async () => {
    const transcribeFile = vi
      .spyOn(asrService, 'transcribeFile')
      .mockResolvedValue({ text: '  list the files here \n' });
    const signal = new AbortController().signal;

    await expect(transcribeVoiceMessage('file-1', signal)).resolves.toBe('list the files here');
    expect(transcribeFile).toHaveBeenCalledWith(
      { fileId: 'file-1', model: 'whisper-1', provider: 'openai' },
      signal,
    );
  });

  it('rejects an empty transcript instead of sending a blank prompt', async () => {
    vi.spyOn(asrService, 'transcribeFile').mockResolvedValue({ text: '   ' });

    await expect(transcribeVoiceMessage('file-1')).rejects.toThrow(
      'Voice message transcript is empty',
    );
  });
});
