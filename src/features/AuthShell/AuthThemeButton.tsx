'use client';

import { ActionIcon, DropdownMenu, type DropdownMenuProps, Icon } from '@lobehub/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { memo, useMemo } from 'react';

const themeIcons = {
  dark: Moon,
  light: Sun,
  system: Monitor,
} as const;

const AuthThemeButton = memo<{ size?: number }>((props) => {
  const { setTheme, theme } = useNextThemesTheme();

  const items = useMemo<DropdownMenuProps['items']>(
    () => [
      {
        icon: <Icon icon={themeIcons.system} />,
        key: 'system',
        label: 'Auto',
        onClick: () => setTheme('system'),
      },
      {
        icon: <Icon icon={themeIcons.light} />,
        key: 'light',
        label: 'Light',
        onClick: () => setTheme('light'),
      },
      {
        icon: <Icon icon={themeIcons.dark} />,
        key: 'dark',
        label: 'Dark',
        onClick: () => setTheme('dark'),
      },
    ],
    [setTheme],
  );

  return (
    <DropdownMenu items={items}>
      <ActionIcon
        icon={themeIcons[(theme as 'dark' | 'light' | 'system') || 'system']}
        size={props.size || { blockSize: 32, size: 16 }}
      />
    </DropdownMenu>
  );
});

AuthThemeButton.displayName = 'AuthThemeButton';

export default AuthThemeButton;
