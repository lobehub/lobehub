import chroma from 'chroma-js';

/** Returns true only for parseable colors whose alpha channel is fully transparent. */
export const isFullyTransparentColor = (color: string): boolean =>
  chroma.valid(color) && chroma(color).alpha() === 0;

export const convertAlphaToSolid = (foreground: string, background: string): string => {
  const fgColor = chroma(foreground);
  const bgColor = chroma(background);

  const alpha = fgColor.alpha();
  const alphaComplement = 1 - alpha;

  const mixedColor: [number, number, number] = [
    fgColor.get('rgb.r') * alpha + bgColor.get('rgb.r') * alphaComplement,
    fgColor.get('rgb.g') * alpha + bgColor.get('rgb.g') * alphaComplement,
    fgColor.get('rgb.b') * alpha + bgColor.get('rgb.b') * alphaComplement,
  ];

  const resultColor = chroma(mixedColor);

  return resultColor.hex();
};
