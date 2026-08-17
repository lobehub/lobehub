import { REALTIME_ASR_AUDIO } from './contract';

const WORKLET_NAME = 'lobe-realtime-asr-pcm';

export class PcmFrameProcessor {
  inputBuffer: number[] = [];
  outputBuffer: number[] = [];
  sourcePosition = 0;

  constructor(
    readonly inputSampleRate: number,
    readonly outputSampleRate = 16_000,
    readonly frameSamples = 3200,
  ) {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
      throw new Error('invalid_input_sample_rate');
    }
  }

  process(channels: readonly Float32Array[]): ArrayBuffer[] {
    if (channels.length === 0 || channels[0].length === 0) return [];

    const sampleCount = channels[0].length;
    for (let index = 0; index < sampleCount; index += 1) {
      let mixed = 0;
      let channelCount = 0;
      for (const channel of channels) {
        if (index >= channel.length) continue;
        mixed += channel[index];
        channelCount += 1;
      }
      this.inputBuffer.push(channelCount > 0 ? mixed / channelCount : 0);
    }

    this.resample(false);
    return this.takeFrames(false);
  }

  flush(): ArrayBuffer[] {
    this.resample(true);
    this.inputBuffer = [];
    this.sourcePosition = 0;
    return this.takeFrames(true);
  }

  resample(flush: boolean) {
    const ratio = this.inputSampleRate / this.outputSampleRate;
    const limit = flush ? this.inputBuffer.length : Math.max(0, this.inputBuffer.length - 1);

    while (this.sourcePosition < limit) {
      const leftIndex = Math.floor(this.sourcePosition);
      const rightIndex = Math.min(leftIndex + 1, this.inputBuffer.length - 1);
      const fraction = this.sourcePosition - leftIndex;
      const left = this.inputBuffer[leftIndex] ?? 0;
      const right = this.inputBuffer[rightIndex] ?? left;
      this.outputBuffer.push(left + (right - left) * fraction);
      this.sourcePosition += ratio;
    }

    if (!flush) {
      const consumed = Math.min(Math.floor(this.sourcePosition), this.inputBuffer.length - 1);
      if (consumed > 0) {
        this.inputBuffer = this.inputBuffer.slice(consumed);
        this.sourcePosition -= consumed;
      }
    }
  }

  takeFrames(padFinalFrame: boolean): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];
    while (this.outputBuffer.length >= this.frameSamples) {
      frames.push(this.toPcm16(this.outputBuffer.splice(0, this.frameSamples)));
    }

    if (padFinalFrame && this.outputBuffer.length > 0) {
      const finalSamples = this.outputBuffer.splice(0);
      while (finalSamples.length < this.frameSamples) finalSamples.push(0);
      frames.push(this.toPcm16(finalSamples));
    }

    return frames;
  }

  toPcm16(samples: number[]): ArrayBuffer {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      const pcm = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(index * 2, pcm, true);
    }
    return buffer;
  }
}

const createWorkletSource = () => `
const PcmFrameProcessor = ${PcmFrameProcessor.toString()};
class RealtimeAsrAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new PcmFrameProcessor(sampleRate, ${REALTIME_ASR_AUDIO.sampleRate}, ${REALTIME_ASR_AUDIO.frameBytes / 2});
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return;
      for (const frame of this.core.flush()) {
        this.port.postMessage({ frame, type: 'frame' }, [frame]);
      }
      this.port.postMessage({ type: 'flushed' });
    };
  }
  process(inputs) {
    for (const frame of this.core.process(inputs[0] || [])) {
      this.port.postMessage({ frame, type: 'frame' }, [frame]);
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', RealtimeAsrAudioProcessor);
`;

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export interface RealtimeAudioCapture {
  cancel: () => Promise<void>;
  start: (onFrame: (frame: ArrayBuffer) => void, onError: () => void) => Promise<void>;
  stop: () => Promise<void>;
}

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

export const requestDictationMicrophone = async (): Promise<MediaStream> => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('microphone_not_supported');
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
};

export class BrowserAudioWorkletCapture implements RealtimeAudioCapture {
  readonly #context: AudioContext;
  readonly #gain: GainNode;
  readonly #node: AudioWorkletNode;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #stream: MediaStream;
  #connected = false;
  #disposed = false;
  #flushResolve?: () => void;

  private constructor(options: {
    context: AudioContext;
    gain: GainNode;
    node: AudioWorkletNode;
    source: MediaStreamAudioSourceNode;
    stream: MediaStream;
  }) {
    this.#context = options.context;
    this.#gain = options.gain;
    this.#node = options.node;
    this.#source = options.source;
    this.#stream = options.stream;
  }

  static async create(stream: MediaStream): Promise<BrowserAudioWorkletCapture> {
    const AudioContextConstructor =
      window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextConstructor || typeof AudioWorkletNode === 'undefined') {
      stopStream(stream);
      throw new Error('audio_worklet_not_supported');
    }

    const context = new AudioContextConstructor();
    const sourceUrl = URL.createObjectURL(
      new Blob([createWorkletSource()], { type: 'text/javascript' }),
    );
    try {
      await context.audioWorklet.addModule(sourceUrl);
      const node = new AudioWorkletNode(context, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 0;
      return new BrowserAudioWorkletCapture({ context, gain, node, source, stream });
    } catch (error) {
      stopStream(stream);
      await context.close().catch(() => undefined);
      throw error;
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  async start(onFrame: (frame: ArrayBuffer) => void, onError: () => void) {
    if (this.#disposed) throw new Error('audio_capture_disposed');

    this.#node.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'frame' && event.data.frame instanceof ArrayBuffer) {
        onFrame(event.data.frame);
      } else if (event.data?.type === 'flushed') {
        this.#flushResolve?.();
        this.#flushResolve = undefined;
      }
    };
    this.#node.addEventListener('processorerror', onError, { once: true });
    this.#source.connect(this.#node);
    this.#node.connect(this.#gain);
    this.#gain.connect(this.#context.destination);
    this.#connected = true;
    if (this.#context.state === 'suspended') await this.#context.resume();
  }

  async stop() {
    if (this.#disposed) return;
    if (this.#connected) {
      this.#source.disconnect();
      this.#connected = false;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.#flushResolve = undefined;
        resolve();
      }, 1000);
      this.#flushResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.#node.port.postMessage({ type: 'flush' });
    });
    await this.cancel();
  }

  async cancel() {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#connected) this.#source.disconnect();
    this.#connected = false;
    this.#node.disconnect();
    this.#gain.disconnect();
    stopStream(this.#stream);
    if (this.#context.state !== 'closed') await this.#context.close().catch(() => undefined);
  }
}
