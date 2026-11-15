// @vitest-environment node
import { stt } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { describe, expect, it, vi } from 'vitest';

import type { LobeHubBridge } from './bridge';
import { LobeHubSTT, LobeHubTTS } from './speech';

describe('LobeHub speech providers', () => {
  it('starts without OpenAI credentials and sends valid WAV to the user provider', async () => {
    const requestSpeech = vi
      .fn()
      .mockResolvedValue({ ok: true, requestId: crypto.randomUUID(), text: 'Hello' });
    const bridge = { requestSpeech } as unknown as LobeHubBridge;
    const provider = new LobeHubSTT(bridge, 'en');
    const frame = new AudioFrame(new Int16Array([0, 100, -100, 0]), 16000, 1, 4);
    const result = await provider._recognize(frame);
    expect(result.type).toBe(stt.SpeechEventType.FINAL_TRANSCRIPT);
    expect(result.alternatives?.[0].text).toBe('Hello');
    const wav = Buffer.from(requestSpeech.mock.calls[0][0].audioBase64, 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(new LobeHubTTS(bridge).sampleRate).toBe(24000);
  });
  it('does not send an aborted recognition request', async () => {
    const requestSpeech = vi.fn();
    const provider = new LobeHubSTT({ requestSpeech } as unknown as LobeHubBridge, 'en');
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider._recognize(new AudioFrame(new Int16Array(4), 16000, 1, 4), controller.signal),
    ).rejects.toThrow();
    expect(requestSpeech).not.toHaveBeenCalled();
  });
});
