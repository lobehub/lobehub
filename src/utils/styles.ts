import { type CSSProperties } from 'react';

export const StyleSheet = {
  compose: (...styles: Array<CSSProperties | undefined | null | false>): CSSProperties => {
    return Object.assign({}, ...styles.filter(Boolean));
  },
  create: (styles: Record<string, CSSProperties>) => {
    return styles;
  },
};
