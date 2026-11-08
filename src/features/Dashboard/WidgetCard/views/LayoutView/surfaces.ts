// lobe-design-ignore-file LOBE-RAW-COLOR: widget surfaces are fixed, theme-independent card colors under white text (like OS home-screen widgets); palette tokens cannot express them because the dark algorithm inverts palette steps (gray10 / geekblue9 turn light), which made "night" pale in dark mode.
import type { WidgetLayoutSurface } from '@lobechat/types';
import type { CSSProperties } from 'react';

const gradient = (from: string, to: string): CSSProperties => ({
  backgroundColor: to,
  backgroundImage: `linear-gradient(165deg, ${from} 0%, ${to} 100%)`,
  borderColor: 'transparent',
  color: '#fff',
});

/**
 * Card backgrounds a layout can pick. Each is a fixed mid-to-deep gradient
 * under white text, so it reads the same in light and dark mode; `default`
 * keeps the theme's card. Text inside follows `currentColor` and secondary
 * tones dim it by opacity, so every primitive works on every surface.
 */
export const WIDGET_SURFACE_STYLES: Record<WidgetLayoutSurface, CSSProperties | undefined> = {
  cloudy: gradient('#8A9BB0', '#56677D'),
  default: undefined,
  forest: gradient('#4E8A63', '#2B5A3E'),
  night: gradient('#2E3D6B', '#10172F'),
  ocean: gradient('#2BA4B5', '#1A6489'),
  rain: gradient('#5E7593', '#33445B'),
  rose: gradient('#EF8AA6', '#C24C76'),
  sand: gradient('#E2B25C', '#B9772F'),
  sky: gradient('#5AB4F8', '#2A72D6'),
  slate: gradient('#3B4251', '#1D2129'),
  snow: gradient('#9FBAD8', '#6888B0'),
  storm: gradient('#4C5070', '#20213A'),
  sunset: gradient('#F5A066', '#D2546A'),
};
