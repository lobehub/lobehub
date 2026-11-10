import { DEFAULT_ASR_MODEL, DEFAULT_ASR_PROVIDER } from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { asrService } from '@/services/asr';
import { useUserStore } from '@/store/user';

import { transcribeVoiceMessage } from './transcribeVoiceMessage';

const initialUserState = useUserStore.getState();

const setAsr = (asr: { model: string; provider: string }) =>
  useUserStore.setState({ settings: { systemAgent: { asr } } } as any);

afterEach(() => {
  vi.restoreAllMocks();
  useUserStore.setState(initialUserState, true);
});

describe('transcribeVoiceMessage', () => {
  it('transcribes the uploaded recording by file id with the configured STT model', async () => {
    setAsr({ model: 'gpt-4o-mini-transcribe', provider: 'lobehub' });
    const transcribeFile = vi
      .spyOn(asrService, 'transcribeFile')
      .mockResolvedValue({ text: '  list the files here \n' });
    const signal = new AbortController().signal;

    await expect(transcribeVoiceMessage('file-1', signal)).resolves.toBe('list the files here');
    expect(transcribeFile).toHaveBeenCalledWith(
      { fileId: 'file-1', model: 'gpt-4o-mini-transcribe', provider: 'lobehub' },
      signal,
    );
  });

  it('rejects an empty transcript instead of sending a blank prompt', async () => {
    setAsr({ model: 'whisper-1', provider: 'openai' });
    vi.spyOn(asrService, 'transcribeFile').mockResolvedValue({ text: '   ' });

    await expect(transcribeVoiceMessage('file-1')).rejects.toThrow(
      'Voice message transcript is empty',
    );
  });

  it('falls back to the default STT model when none is chosen', async () => {
    const transcribeFile = vi
      .spyOn(asrService, 'transcribeFile')
      .mockResolvedValue({ text: 'hello' });

    await expect(transcribeVoiceMessage('file-1')).resolves.toBe('hello');
    expect(transcribeFile).toHaveBeenCalledWith(
      { fileId: 'file-1', model: DEFAULT_ASR_MODEL, provider: DEFAULT_ASR_PROVIDER },
      undefined,
    );
  });

  it('refuses to transcribe after the STT model is cleared', async () => {
    setAsr({ model: '', provider: '' });
    const transcribeFile = vi.spyOn(asrService, 'transcribeFile');

    await expect(transcribeVoiceMessage('file-1')).rejects.toThrow(
      'No speech-to-text model is configured',
    );
    expect(transcribeFile).not.toHaveBeenCalled();
  });
});
