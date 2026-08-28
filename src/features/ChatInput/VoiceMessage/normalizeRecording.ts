const WAVE_MIME_TYPE = 'audio/wav';
const WAVE_CODEC = 'pcm_s16le';
const WAVE_SAMPLE_RATE = 16_000;
const WAVE_HEADER_SIZE = 44;

interface AudioBufferLike {
  getChannelData: (channel: number) => Float32Array;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
}

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export interface NormalizedVoiceRecording {
  blob: Blob;
  codec: string;
  mimeType: string;
}

type DecodeAudioBlob = (blob: Blob) => Promise<AudioBufferLike>;

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

export const downmixAndResample = (
  audioBuffer: AudioBufferLike,
  targetSampleRate = WAVE_SAMPLE_RATE,
): Float32Array => {
  const { length, numberOfChannels, sampleRate } = audioBuffer;
  if (length === 0 || numberOfChannels === 0 || sampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error('The recorded audio could not be decoded');
  }

  const channels = Array.from({ length: numberOfChannels }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );
  const targetLength = Math.max(1, Math.round((length * targetSampleRate) / sampleRate));
  const result = new Float32Array(targetLength);
  const sourceFramesPerTargetFrame = sampleRate / targetSampleRate;

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    if (sourceFramesPerTargetFrame < 1) {
      const sourcePosition = targetIndex * sourceFramesPerTargetFrame;
      const lowerIndex = Math.min(length - 1, Math.floor(sourcePosition));
      const upperIndex = Math.min(length - 1, lowerIndex + 1);
      const mix = sourcePosition - lowerIndex;
      let sample = 0;

      for (const channel of channels) {
        sample += channel[lowerIndex] * (1 - mix) + channel[upperIndex] * mix;
      }

      result[targetIndex] = sample / numberOfChannels;
      continue;
    }

    const start = Math.min(length - 1, Math.floor(targetIndex * sourceFramesPerTargetFrame));
    const end = Math.max(
      start + 1,
      Math.min(length, Math.floor((targetIndex + 1) * sourceFramesPerTargetFrame)),
    );
    let sample = 0;

    for (const channel of channels) {
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
        sample += channel[sourceIndex];
      }
    }

    result[targetIndex] = sample / ((end - start) * numberOfChannels);
  }

  return result;
};

export const encodePcm16Wav = (samples: Float32Array, sampleRate = WAVE_SAMPLE_RATE): Blob => {
  const bytesPerSample = 2;
  const arrayBuffer = new ArrayBuffer(WAVE_HEADER_SIZE + samples.length * bytesPerSample);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, arrayBuffer.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  for (let index = 0; index < samples.length; index += 1) {
    const finiteSample = Number.isFinite(samples[index]) ? samples[index] : 0;
    const sample = Math.max(-1, Math.min(1, finiteSample));
    view.setInt16(
      WAVE_HEADER_SIZE + index * bytesPerSample,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }

  return new Blob([arrayBuffer], { type: WAVE_MIME_TYPE });
};

const decodeAudioBlob: DecodeAudioBlob = async (blob) => {
  const AudioContextConstructor =
    window.AudioContext || (window as WebkitWindow).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio is unavailable');

  const audioContext = new AudioContextConstructor();
  try {
    return await audioContext.decodeAudioData(await blob.arrayBuffer());
  } finally {
    if (audioContext.state !== 'closed') await audioContext.close();
  }
};

/**
 * MediaRecorder outputs browser-specific containers (WebM/Opus in Chrome and MP4/AAC in
 * Safari). Normalize them before upload because audio-capable model providers do not share a
 * common compressed-container contract. WAV/PCM gives provider adapters a broadly supported
 * canonical input while keeping the existing audioList path and never converting audio to text.
 */
export const normalizeVoiceRecording = async (
  blob: Blob,
  decode: DecodeAudioBlob = decodeAudioBlob,
): Promise<NormalizedVoiceRecording> => {
  const audioBuffer = await decode(blob);
  const samples = downmixAndResample(audioBuffer);

  return {
    blob: encodePcm16Wav(samples),
    codec: WAVE_CODEC,
    mimeType: WAVE_MIME_TYPE,
  };
};
