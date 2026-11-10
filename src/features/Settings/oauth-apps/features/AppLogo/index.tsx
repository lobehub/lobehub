'use client';

import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AppWindowIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  // An upload target reads as an empty slot: outline only, no fill.
  dashed: { borderWidth: '1px', borderStyle: 'dashed', borderColor: cssVar.colorBorder },
  filled: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
  placeholder: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    color: cssVar.colorTextTertiary,
  },
});

interface AppLogoPlaceholderProps {
  /** Dashed outline, for slots where the placeholder is also an upload target. */
  dashed?: boolean;
  size: number;
}

/**
 * Stand-in for an OAuth app without a logo. A letter avatar built from the app
 * name renders CJK names as two oversized glyphs and reads as an unfinished
 * state, so every surface falls back to the same app glyph instead.
 */
export const AppLogoPlaceholder = memo<AppLogoPlaceholderProps>(({ dashed, size }) => (
  <span
    className={stylex.props(styles.placeholder, dashed ? styles.dashed : styles.filled).className}
    style={{ borderRadius: Math.max(size / 6, 2), height: size, width: size }}
  >
    <Icon icon={AppWindowIcon} size={Math.round(size * 0.45)} />
  </span>
));

AppLogoPlaceholder.displayName = 'AppLogoPlaceholder';

interface AppLogoProps {
  logoUri?: string | null;
  name: string;
  size: number;
}

const AppLogo = memo<AppLogoProps>(({ logoUri, name, size }) =>
  logoUri ? (
    <Avatar avatar={logoUri} shape={'square'} size={size} title={name} />
  ) : (
    <AppLogoPlaceholder size={size} />
  ),
);

AppLogo.displayName = 'AppLogo';

export default AppLogo;
