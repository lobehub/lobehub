import { type CSSProperties } from 'react';

export interface SVGComponent {
  className?: string;
  height?: number | string;
  style?: CSSProperties;
  width?: number | string;
}
