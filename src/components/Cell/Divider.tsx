'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

const styles = stylex.create({
  dividerDark: {
    flex: 'none',
    width: '100%',
    height: '6px',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorFillTertiary} 4%, transparent)`,
    backgroundImage: 'none',
  },
  dividerLight: {
    flex: 'none',
    width: '100%',
    height: '6px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

const Divider = memo(() => {
  const isDarkMode = useIsDark();

  return <div {...stylex.props(isDarkMode ? styles.dividerDark : styles.dividerLight)} />;
});

export default Divider;
