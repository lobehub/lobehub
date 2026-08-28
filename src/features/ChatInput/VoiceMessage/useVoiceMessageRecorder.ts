'use client';

import { type VoiceMessageRecording } from '@lobechat/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getAudioFileExtension,
  getVoiceRecorderErrorCode,
  resolveRecordingMimeType,
  selectRecordingMimeType,
  VOICE_MESSAGE_MAX_DURATION_MS,
  VOICE_MESSAGE_MIN_DURATION_MS,
  type VoiceRecorderErrorCode,
} from './mediaRecorder';
import { type NormalizedVoiceRecording, normalizeVoiceRecording } from './normalizeRecording';

const WAVEFORM_BAR_COUNT = 28;
const WAVEFORM_FFT_SIZE = 64;
const WAVEFORM_MIN_LEVEL = 0.08;
const WAVEFORM_UPDATE_INTERVAL_MS = 80;
const TIMER_INTERVAL_MS = 100;
const DATA_SLICE_MS = 250;

const initialWaveform = () => Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.12);

export const createWaveformSamples = (
  analyser: Pick<AnalyserNode, 'fftSize' | 'smoothingTimeConstant'>,
) => {
  analyser.fftSize = WAVEFORM_FFT_SIZE;
  analyser.smoothingTimeConstant = 0.7;

  return new Uint8Array(analyser.fftSize);
};

export const calculateWaveformLevel = (samples: Uint8Array) => {
  if (samples.length === 0) return WAVEFORM_MIN_LEVEL;

  let energy = 0;
  for (const value of samples) {
    const normalized = (value - 128) / 128;
    energy += normalized * normalized;
  }

  const rms = Math.sqrt(energy / samples.length);
  return Math.min(1, Math.max(WAVEFORM_MIN_LEVEL, rms * 2.5));
};

type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'ready' | 'error';

interface VoiceMessageRecorderOptions {
  maxDurationMs?: number;
  minDurationMs?: number;
  normalizeRecording?: (blob: Blob) => Promise<NormalizedVoiceRecording>;
  now?: () => number;
}

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const stopStream = (stream?: MediaStream) => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

export const useVoiceMessageRecorder = ({
  maxDurationMs = VOICE_MESSAGE_MAX_DURATION_MS,
  minDurationMs = VOICE_MESSAGE_MIN_DURATION_MS,
  normalizeRecording = normalizeVoiceRecording,
  now = Date.now,
}: VoiceMessageRecorderOptions = {}) => {
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<VoiceRecorderErrorCode>();
  const [recording, setRecording] = useState<VoiceMessageRecording>();
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [waveform, setWaveform] = useState<number[]>(initialWaveform);

  const analyserFrameRef = useRef<number | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const lastWaveformUpdateRef = useRef(0);
  const mountedRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const recordingRef = useRef<VoiceMessageRecording | undefined>(undefined);
  const requestIdRef = useRef(0);
  const sourceRef = useRef<MediaStreamAudioSourceNode | undefined>(undefined);
  const startedAtRef = useRef(0);
  const stopPromiseRef = useRef<Promise<VoiceMessageRecording | undefined> | undefined>(undefined);
  const stopRequestIdRef = useRef<number | undefined>(undefined);
  const stopResolveRef = useRef<((recording?: VoiceMessageRecording) => void) | undefined>(
    undefined,
  );
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const wasCancelledRef = useRef(false);
  const waveformRef = useRef(waveform);

  waveformRef.current = waveform;

  const cleanupCapture = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = undefined;

    if (analyserFrameRef.current !== undefined) {
      cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = undefined;
    }

    sourceRef.current?.disconnect();
    sourceRef.current = undefined;

    const audioContext = audioContextRef.current;
    audioContextRef.current = undefined;
    if (audioContext && audioContext.state !== 'closed') void audioContext.close();

    stopStream(streamRef.current);
    streamRef.current = undefined;
  }, []);

  const settleStopPromise = useCallback((value?: VoiceMessageRecording, requestId?: number) => {
    if (requestId !== undefined && stopRequestIdRef.current !== requestId) return;

    stopResolveRef.current?.(value);
    stopResolveRef.current = undefined;
    stopPromiseRef.current = undefined;
    stopRequestIdRef.current = undefined;
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    wasCancelledRef.current = true;

    const recorder = recorderRef.current;
    recorderRef.current = undefined;
    if (recorder && recorder.state !== 'inactive') recorder.stop();

    cleanupCapture();
    recordingRef.current = undefined;
    settleStopPromise();

    if (mountedRef.current) {
      setDurationMs(0);
      setError(undefined);
      setRecording(undefined);
      setStatus('idle');
      setWaveform(initialWaveform());
    }
  }, [cleanupCapture, settleStopPromise]);

  const setupWaveform = useCallback((stream: MediaStream) => {
    const AudioContextConstructor =
      window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextConstructor) return;

    try {
      const audioContext = audioContextRef.current ?? new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const samples = createWaveformSamples(analyser);

      source.connect(analyser);

      audioContextRef.current = audioContext;
      sourceRef.current = source;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      const sample = (timestamp: number) => {
        analyserFrameRef.current = requestAnimationFrame(sample);
        if (timestamp - lastWaveformUpdateRef.current < WAVEFORM_UPDATE_INTERVAL_MS) return;
        lastWaveformUpdateRef.current = timestamp;

        analyser.getByteTimeDomainData(samples);
        const level = calculateWaveformLevel(samples);
        setWaveform((current) => [...current.slice(1), level]);
      };

      analyserFrameRef.current = requestAnimationFrame(sample);
    } catch {
      // Recording still works without Web Audio visualization.
    }
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('not_supported');
      setStatus('error');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('not_supported');
      setStatus('error');
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    wasCancelledRef.current = false;
    setDurationMs(0);
    setError(undefined);
    setRecording(undefined);
    setStatus('requesting');
    setWaveform(initialWaveform());

    let stream: MediaStream | undefined;

    try {
      const AudioContextConstructor =
        window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (AudioContextConstructor) {
        try {
          const audioContext = new AudioContextConstructor();
          audioContextRef.current = audioContext;
          if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
        } catch {
          // Recording still works when Web Audio visualization is unavailable.
        }
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (requestIdRef.current !== requestId || wasCancelledRef.current) {
        stopStream(stream);
        return;
      }

      const requestedMimeType = selectRecordingMimeType(MediaRecorder);
      const recorder = requestedMimeType
        ? new MediaRecorder(stream, { mimeType: requestedMimeType })
        : new MediaRecorder(stream);

      const chunks: Blob[] = [];
      let recorderFailed = false;
      recorderRef.current = recorder;
      streamRef.current = stream;
      startedAtRef.current = now();
      stopPromiseRef.current = new Promise((resolve) => {
        stopResolveRef.current = resolve;
      });
      stopRequestIdRef.current = requestId;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        if (requestIdRef.current !== requestId) return;

        recorderFailed = true;
        cleanupCapture();
        recorderRef.current = undefined;
        settleStopPromise(undefined, requestId);
        if (!mountedRef.current || wasCancelledRef.current) return;

        setError(getVoiceRecorderErrorCode((event as Event & { error?: unknown }).error));
        setStatus('error');
      });
      recorder.addEventListener('stop', async () => {
        if (requestIdRef.current !== requestId) {
          settleStopPromise(undefined, requestId);
          return;
        }

        cleanupCapture();
        recorderRef.current = undefined;

        if (wasCancelledRef.current || recorderFailed) {
          settleStopPromise(undefined, requestId);
          return;
        }

        const finalDurationMs = Math.min(maxDurationMs, Math.max(0, now() - startedAtRef.current));
        const mimeType = resolveRecordingMimeType(recorder.mimeType, chunks, requestedMimeType);
        const blob = new Blob(chunks, { type: mimeType });

        if (blob.size === 0) {
          settleStopPromise(undefined, requestId);
          if (requestIdRef.current === requestId && mountedRef.current) {
            setError('recording_failed');
            setStatus('error');
          }
          return;
        }

        let normalizedRecording: NormalizedVoiceRecording;
        try {
          normalizedRecording = await normalizeRecording(blob);
        } catch {
          settleStopPromise(undefined, requestId);
          if (
            requestIdRef.current === requestId &&
            mountedRef.current &&
            !wasCancelledRef.current
          ) {
            setError('recording_failed');
            setStatus('error');
          }
          return;
        }

        if (requestIdRef.current !== requestId || wasCancelledRef.current || recorderFailed) {
          settleStopPromise(undefined, requestId);
          return;
        }

        const file = new File(
          [normalizedRecording.blob],
          `voice-message-${now()}.${getAudioFileExtension(normalizedRecording.mimeType)}`,
          { type: normalizedRecording.mimeType },
        );
        const nextRecording: VoiceMessageRecording = {
          codec: normalizedRecording.codec,
          durationMs: finalDurationMs,
          file,
          mimeType: normalizedRecording.mimeType,
          waveform: waveformRef.current,
        };

        recordingRef.current = nextRecording;
        settleStopPromise(nextRecording, requestId);
        if (mountedRef.current) {
          setDurationMs(finalDurationMs);
          setRecording(nextRecording);
          setStatus('ready');
        }
      });

      recorder.start(DATA_SLICE_MS);
      setupWaveform(stream);
      setStatus('recording');

      intervalRef.current = setInterval(() => {
        const elapsed = Math.min(maxDurationMs, Math.max(0, now() - startedAtRef.current));
        if (mountedRef.current) setDurationMs(elapsed);

        if (elapsed >= maxDurationMs && recorder.state === 'recording') {
          if (mountedRef.current) setStatus('stopping');
          recorder.stop();
        }
      }, TIMER_INTERVAL_MS);
    } catch (cause) {
      stopStream(stream);
      if (requestIdRef.current !== requestId) return;

      cleanupCapture();
      recorderRef.current = undefined;
      settleStopPromise(undefined, requestId);
      if (!mountedRef.current) return;

      setError(getVoiceRecorderErrorCode(cause));
      setStatus('error');
    }
  }, [cleanupCapture, maxDurationMs, normalizeRecording, now, settleStopPromise, setupWaveform]);

  const stop = useCallback(async (): Promise<VoiceMessageRecording | undefined> => {
    if (recordingRef.current) return recordingRef.current;

    const recorder = recorderRef.current;
    const promise = stopPromiseRef.current;
    if (!recorder || !promise) return;

    if (recorder.state === 'recording') {
      setStatus('stopping');
      recorder.stop();
    }

    return promise;
  }, []);

  const cancel = useCallback(() => {
    reset();
  }, [reset]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      wasCancelledRef.current = true;

      const recorder = recorderRef.current;
      recorderRef.current = undefined;
      if (recorder && recorder.state !== 'inactive') recorder.stop();

      cleanupCapture();
      settleStopPromise();
    };
  }, [cleanupCapture, settleStopPromise]);

  return {
    cancel,
    canSend: durationMs >= minDurationMs && (status === 'recording' || status === 'ready'),
    durationMs,
    error,
    maxDurationMs,
    minDurationMs,
    recording,
    reset,
    start,
    status,
    stop,
    waveform,
  };
};
