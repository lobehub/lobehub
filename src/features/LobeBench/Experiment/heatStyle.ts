import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

/** A category cell's colours: greener the higher its pass rate, muted with none. */
export const heatStyle = (rate: number | undefined) => {
  if (rate === undefined)
    return { background: cssVar.colorFillQuaternary, color: cssVar.colorTextQuaternary };
  const alpha = 0.12 + rate * 0.5;
  return {
    background: `color-mix(in srgb, ${cssVar.colorSuccess} ${Math.round(alpha * 100)}%, transparent)`,
    color: cssVar.colorText,
  };
};
