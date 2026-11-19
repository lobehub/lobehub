export interface StageSize {
  height: number;
  width: number;
}

export interface StagePadding {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export type StageFitMode = 'contain' | 'scroll';

export interface StageFit {
  height: number;
  mode: StageFitMode;
  scale: number;
  tall: boolean;
  width: number;
}

// Aspect, not pixels: the tallest phone screens sit near 2.4, and a ratio reads
// the same at 1x and 3x where a pixel threshold would not.
export const TALL_IMAGE_ASPECT = 2.5;

const isMeasured = (size?: Partial<StageSize>): size is StageSize =>
  Boolean(size?.width && size.height && size.width > 0 && size.height > 0);

const wholePixels = (value: number) => Math.floor(value + 1e-6);

export const stageContentBox = (
  size: Partial<StageSize>,
  padding: StagePadding,
): StageSize | undefined => {
  if (!isMeasured(size)) return;
  const box = {
    height: size.height - padding.top - padding.bottom,
    width: size.width - padding.left - padding.right,
  };
  return isMeasured(box) ? box : undefined;
};

export const resolveStageFit = ({
  fitHeight = false,
  natural,
  stage,
}: {
  fitHeight?: boolean;
  natural?: Partial<StageSize>;
  stage?: Partial<StageSize>;
}): StageFit | undefined => {
  if (!isMeasured(natural) || !isMeasured(stage)) return;

  const widthScale = Math.min(stage.width / natural.width, 1);
  const containScale = Math.min(widthScale, stage.height / natural.height);
  const tall =
    natural.height / natural.width > TALL_IMAGE_ASPECT &&
    natural.height * widthScale > stage.height;
  const mode: StageFitMode = tall && !fitHeight ? 'scroll' : 'contain';
  const scale = mode === 'scroll' ? widthScale : containScale;

  return {
    height: wholePixels(natural.height * scale),
    mode,
    scale,
    tall,
    width: wholePixels(natural.width * scale),
  };
};
