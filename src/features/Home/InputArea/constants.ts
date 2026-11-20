import type { InterfaceDensity } from '@lobechat/types';

export interface HomeInputMetrics {
  actionBarHeight: number;
  bodyHeight: number;
  frameHeight: number;
  radius: number;
  reservedHeight: number;
  sendButtonSize?: number;
}

export const HOME_INPUT_BOTTOM_PADDING = 8;

const createInputMetrics = ({
  actionBarHeight,
  bodyHeight,
  radius,
  sendButtonSize,
}: Pick<HomeInputMetrics, 'actionBarHeight' | 'bodyHeight' | 'radius' | 'sendButtonSize'>) => {
  // The rich ChatInput adds a one-pixel border on both block edges.
  const frameHeight = bodyHeight + actionBarHeight + 2;
  return {
    actionBarHeight,
    bodyHeight,
    frameHeight,
    radius,
    reservedHeight: frameHeight + HOME_INPUT_BOTTOM_PADDING,
    sendButtonSize,
  };
};

export const HOME_INPUT_METRICS: Record<InterfaceDensity, HomeInputMetrics> = {
  // 4px bar padding + the 28px send button + the 8px corner inset.
  compact: createInputMetrics({
    actionBarHeight: 40,
    bodyHeight: 80,
    radius: 16,
    sendButtonSize: 28,
  }),
  loose: createInputMetrics({ actionBarHeight: 40, bodyHeight: 108, radius: 20 }),
};

/**
 * The Home composer's upload list key. Its text survives mode and agent
 * switches, so its attachments use one key rather than the per-mode, per-agent
 * context selection key.
 */
export const HOME_UPLOAD_CONTEXT_KEY = 'home';
