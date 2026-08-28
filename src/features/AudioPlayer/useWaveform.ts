import { useEffect, useRef, useState } from 'react';

export const BAR_COUNT = 56;

// Skip decoding files larger than this. decodeAudioData holds the full decoded PCM in memory, so
// big recordings would spike memory for what is only a decorative waveform — fall back instead.
const MAX_DECODE_BYTES = 20 * 1024 * 1024;

// Deterministic fallback bars when decoding isn't possible (unsupported codec, CORS, network
// error, oversized file, etc.) so the player still shows a stable, non-flat waveform shape.
const fallbackPeaks = (seed: string): number[] => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;

  return Array.from({ length: BAR_COUNT }, (_, i) => {
    hash = (hash * 1_103_515_245 + 12_345) & 0x7fff_ffff;
    const v = (hash % 1000) / 1000;
    // Taper the ends and bias toward mid heights so it reads as a waveform, not noise.
    const taper = Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
    return 0.2 + v * 0.8 * (0.5 + 0.5 * taper);
  });
};

const extractPeaks = (buffer: AudioBuffer, bars: number): number[] => {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / bars));

  const peaks: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    let sum = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j += 1) sum += Math.abs(channel[start + j] || 0);
    peaks.push(sum / blockSize);
  }

  const max = Math.max(...peaks, 0.000_1);
  // Floor each bar so quiet sections stay visible.
  return peaks.map((p) => Math.max(0.08, p / max));
};

/**
 * Decode an audio url into normalized waveform peaks (0..1) for visualization. Falls back to a
 * deterministic shape if the audio can't be fetched/decoded (e.g. unsupported codec, oversized).
 *
 * The decode is lazy: it only runs once `enabled` is true (set on first playback) so opening a
 * conversation with many audio attachments doesn't download/decode every clip up front.
 */
export const useWaveform = (url: string, enabled: boolean): number[] => {
  const [peaks, setPeaks] = useState<number[]>(() => fallbackPeaks(url));
  const requestedUrl = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    // Avoid re-decoding the same url across re-renders.
    if (requestedUrl.current === url) return;
    requestedUrl.current = url;

    let cancelled = false;
    let ctx: AudioContext | undefined;

    const run = async () => {
      try {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return;

        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled || arrayBuffer.byteLength > MAX_DECODE_BYTES) return;

        ctx = new Ctor();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;

        setPeaks(extractPeaks(audioBuffer, BAR_COUNT));
      } catch {
        // keep the fallback peaks
      } finally {
        await ctx?.close?.();
      }
    };

    void run();

    return () => {
      cancelled = true;
      void ctx?.close?.();
    };
  }, [url, enabled]);

  return peaks;
};
