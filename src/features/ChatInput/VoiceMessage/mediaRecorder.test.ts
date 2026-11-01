import { describe, expect, it, vi } from 'vitest';

import {
  formatVoiceDuration,
  getAudioCodec,
  getAudioFileExtension,
  getVoiceRecorderErrorCode,
  resolveRecordingMimeType,
  selectRecordingMimeType,
} from './mediaRecorder';

describe('voice message media recorder compatibility', () => {
  it('prefers Opus WebM when Chromium reports it as supported', () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/webm;codecs=opus');

    expect(selectRecordingMimeType({ isTypeSupported })).toBe('audio/webm;codecs=opus');
  });

  it('falls back to AAC MP4 for Safari-style support', () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/mp4;codecs=mp4a.40.2');

    expect(selectRecordingMimeType({ isTypeSupported })).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('lets the browser choose when none of the explicit containers are supported', () => {
    expect(selectRecordingMimeType({ isTypeSupported: () => false })).toBeUndefined();
  });

  it('uses the recorder-reported MIME before requested and chunk fallbacks', () => {
    const chunks = [new Blob(['audio'], { type: 'audio/ogg' })];

    expect(resolveRecordingMimeType('audio/mp4', chunks, 'audio/webm')).toBe('audio/mp4');
    expect(resolveRecordingMimeType('', chunks, 'audio/webm')).toBe('audio/ogg');
    expect(resolveRecordingMimeType('', [], 'audio/webm')).toBe('audio/webm');
  });

  it('derives compatible extensions and codec metadata', () => {
    expect(getAudioFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(getAudioFileExtension('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(getAudioCodec('audio/webm;codecs="opus"')).toBe('opus');
    expect(getAudioCodec('audio/mp4')).toBeUndefined();
  });

  it('maps microphone permission errors without treating them as ASR failures', () => {
    expect(getVoiceRecorderErrorCode(new DOMException('denied', 'NotAllowedError'))).toBe(
      'permission_denied',
    );
    expect(getVoiceRecorderErrorCode(new Error('device lost'))).toBe('recording_failed');
  });

  it('formats duration with a stable minute and second width', () => {
    expect(formatVoiceDuration(0)).toBe('0:00');
    expect(formatVoiceDuration(61_900)).toBe('1:01');
  });
});
