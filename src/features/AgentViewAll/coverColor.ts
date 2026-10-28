import type { SidebarAgentItem } from '@lobechat/types';
import { type AgentAvatarColor, cssVar, getAgentAvatarTraits } from '@lobehub/ui';

import { isDefaultAgentAvatar } from '@/components/AgentAvatar';
import { remoteAvatarSrc } from '@/components/Avatar/fallback';

/**
 * The generated character's palette as theme colors. `ink` / `gray` share the
 * gray scale: the cover is mixed toward the container color, which keeps both
 * readable in either theme.
 */
const SEED_COLORS: Record<AgentAvatarColor, string> = {
  geekblue: cssVar.geekblue,
  gray: cssVar.gray,
  ink: cssVar.gray,
  magenta: cssVar.magenta,
  orange: cssVar.orange,
  purple: cssVar.purple,
  volcano: cssVar.volcano,
};

/**
 * Cover color derived from the agent id: the same color its generated
 * character wears, so an agent without an avatar of its own gets a band that
 * matches its face, and any other agent still gets a stable one.
 */
export const seedCoverColor = (item: SidebarAgentItem): string =>
  SEED_COLORS[getAgentAvatarTraits(item.id).color];

/** The uploaded image worth sampling, if the avatar is one. */
export const coverImageSrc = (item: SidebarAgentItem): string | undefined => {
  const { avatar } = item;
  if (typeof avatar !== 'string' || isDefaultAgentAvatar(avatar)) return undefined;

  return remoteAvatarSrc(avatar);
};

const HUE_BINS = 12;
/**
 * Share of opaque pixels that must carry color before the color wins. A logo
 * on white is mostly white, and its edges are anti-aliased toward it, so color
 * has to win on presence, not on pixel count — only a (nearly) colorless image
 * falls back to its neutral average.
 */
const MIN_COLOR_SHARE = 0.03;

interface Bin {
  b: number;
  g: number;
  n: number;
  r: number;
  w: number;
}

const emptyBin = (): Bin => ({ b: 0, g: 0, n: 0, r: 0, w: 0 });

/** Weighted average color of the bins (channels are stored pre-multiplied by weight). */
const average = (bins: Bin[]): string => {
  const total = bins.reduce((sum, bin) => sum + bin.w, 0);
  const channel = (key: 'b' | 'g' | 'r') =>
    Math.round(bins.reduce((sum, bin) => sum + bin[key], 0) / total);

  return `rgb(${channel('r')}, ${channel('g')}, ${channel('b')})`;
};

/**
 * Dominant color of RGBA pixel data. Vivid pixels are bucketed by hue and
 * weighted by the square of how vivid they are, so a logo's pale anti-aliased
 * edges barely tint the result; the heaviest hue (together with its two
 * neighbors, so a gradient split across a bucket edge still counts as one
 * color) gives the average. Washed-out and near-black pixels are ignored
 * unless the image has (almost) no color at all.
 */
export const pickDominantColor = (data: ArrayLike<number>): string | undefined => {
  const hues = Array.from({ length: HUE_BINS }, emptyBin);
  const neutral = emptyBin();
  let colored = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const value = max / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;

    let bin = neutral;
    let weight = 1;
    if (saturation >= 0.25 && value >= 0.2) {
      const delta = max - min;
      let hue =
        max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
      bin = hues[Math.min(HUE_BINS - 1, Math.floor((hue / 360) * HUE_BINS))];
      weight = (saturation * value) ** 2;
      colored += 1;
    }

    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
    bin.n += 1;
    bin.w += weight;
  }

  const opaque = colored + neutral.n;
  if (opaque === 0) return undefined;
  if (colored < Math.max(1, opaque * MIN_COLOR_SHARE)) return average([neutral]);

  const around = (i: number) => [
    hues[(i + HUE_BINS - 1) % HUE_BINS],
    hues[i],
    hues[(i + 1) % HUE_BINS],
  ];
  const weight = (i: number) => around(i).reduce((sum, bin) => sum + bin.w, 0);

  let best = 0;
  for (let i = 1; i < HUE_BINS; i++) if (weight(i) > weight(best)) best = i;

  return average(around(best).filter((bin) => bin.n > 0));
};

const SAMPLE_SIZE = 24;

const sampleImage = (src: string): Promise<string | undefined> =>
  new Promise((resolve) => {
    const image = new Image();
    // Canvas reads need CORS; a host that refuses it taints the canvas and the
    // card keeps its seed color.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.addEventListener('error', () => resolve(undefined));
    image.addEventListener('load', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(undefined);

        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(pickDominantColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data));
      } catch {
        resolve(undefined);
      }
    });
    image.src = src;
  });

// The wall renders a hundred cards and re-renders on every filter change, so
// each image is sampled once per page load, and a finished sample is readable
// synchronously so a remounted card paints its color on the first frame.
const pending = new Map<string, Promise<string | undefined>>();
const settled = new Map<string, string | undefined>();

/** The sampled color of `src`: `undefined` = no color, absent key = not sampled yet. */
export const sampledImageColor = (src: string): { color?: string } | undefined =>
  settled.has(src) ? { color: settled.get(src) } : undefined;

export const sampleImageColor = (src: string): Promise<string | undefined> => {
  let promise = pending.get(src);
  if (!promise) {
    promise = sampleImage(src).then((color) => {
      settled.set(src, color);
      return color;
    });
    pending.set(src, promise);
  }

  return promise;
};
