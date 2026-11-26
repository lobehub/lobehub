// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import * as createSpeechModule from './createSpeech';
import LobeGmicloudSpeechAI from './index';

describe('LobeGmicloudSpeechAI', () => {
  it('requires an API key', () => {
    expect(() => new LobeGmicloudSpeechAI()).toThrow();
    try {
      new LobeGmicloudSpeechAI({ apiKey: '' });
    } catch (error) {
      expect((error as any).errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    }
  });

  it('defaults to the GMI Cloud console host and trims a pasted one', () => {
    expect(new LobeGmicloudSpeechAI({ apiKey: 'k' }).baseURL).toBe('https://console.gmicloud.ai');
    expect(new LobeGmicloudSpeechAI({ apiKey: 'k', baseURL: 'https://proxy.example/' }).baseURL).toBe(
      'https://proxy.example',
    );
  });

  it('implements textToSpeech only', () => {
    const ai = new LobeGmicloudSpeechAI({ apiKey: 'k' });
    expect(typeof ai.textToSpeech).toBe('function');
    expect((ai as any).chat).toBeUndefined();
    expect((ai as any).models).toBeUndefined();
  });

  it('delegates textToSpeech to createGmicloudSpeech with the provider id', async () => {
    const spy = vi
      .spyOn(createSpeechModule, 'createGmicloudSpeech')
      .mockResolvedValue({ audio: new ArrayBuffer(2), format: 'mp3' });
    const ai = new LobeGmicloudSpeechAI({ apiKey: 'k' });

    await ai.textToSpeech({ input: 'hi', model: 'inworld-tts-2', voice: 'Dennis' });

    expect(spy).toHaveBeenCalledWith(
      { input: 'hi', model: 'inworld-tts-2', voice: 'Dennis' },
      expect.objectContaining({ apiKey: 'k', provider: 'gmicloudspeech' }),
    );
  });
});
