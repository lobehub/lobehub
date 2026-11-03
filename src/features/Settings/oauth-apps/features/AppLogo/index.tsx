'use client';

import { Avatar, createStaticStyles, cx, Icon } from '@lobehub/ui';
import { AppWindowIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // An upload target reads as an empty slot: outline only, no fill.
  dashed: css`
    border: 1px dashed ${cssVar.colorBorder};
  `,
  filled: css`
    background: ${cssVar.colorFillTertiary};
  `,
  placeholder: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    color: ${cssVar.colorTextTertiary};
  `,
}));

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
    className={cx(styles.placeholder, dashed ? styles.dashed : styles.filled)}
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
