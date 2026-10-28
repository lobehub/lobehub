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
const NEUTRAL_BIN = HUE_BINS;
/** A neutral pixel counts for less than a saturated one, so a logo on white wins. */
const NEUTRAL_WEIGHT = 0.1;

/**
 * Dominant color of RGBA pixel data: pixels are bucketed by hue, each weighted
 * by how vivid it is, and the heaviest bucket's average is returned. Washed-out
 * and near-black pixels share one neutral bucket, which only wins when the
 * image has (almost) no color at all.
 */
export const pickDominantColor = (data: ArrayLike<number>): string | undefined => {
  const bins = Array.from({ length: HUE_BINS + 1 }, () => ({ b: 0, g: 0, n: 0, r: 0, w: 0 }));

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const value = max / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;

    let index = NEUTRAL_BIN;
    let weight = NEUTRAL_WEIGHT;
    if (saturation >= 0.2 && value >= 0.15) {
      const delta = max - min;
      let hue =
        max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
      index = Math.min(HUE_BINS - 1, Math.floor((hue / 360) * HUE_BINS));
      weight = saturation * value;
    }

    const bin = bins[index];
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.n += 1;
    bin.w += weight;
  }

  const best = bins.reduce((top, bin) => (bin.w > top.w ? bin : top));
  if (best.n === 0) return undefined;

  const channel = (sum: number) => Math.round(sum / best.n);

  return `rgb(${channel(best.r)}, ${channel(best.g)}, ${channel(best.b)})`;
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
// each image is sampled once per page load.
const sampled = new Map<string, Promise<string | undefined>>();

export const sampleImageColor = (src: string): Promise<string | undefined> => {
  let pending = sampled.get(src);
  if (!pending) {
    pending = sampleImage(src);
    sampled.set(src, pending);
  }

  return pending;
};
