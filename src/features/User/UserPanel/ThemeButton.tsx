import { ActionIcon, DropdownMenu, type DropdownMenuProps, Icon } from '@lobehub/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const themeIcons = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

const ThemeButton: FC<{ placement?: DropdownMenuProps['placement']; size?: number }> = ({
  placement,
  size,
}) => {
  const { setTheme, theme } = useNextThemesTheme();

  const { t } = useTranslation('setting');

  const items = useMemo<DropdownMenuProps['items']>(
    () => [
      {
        icon: <Icon icon={themeIcons.system} />,
        key: 'system',
        label: t('settingCommon.themeMode.auto'),
        onClick: () => setTheme('system'),
      },
      {
        icon: <Icon icon={themeIcons.light} />,
        key: 'light',
        label: t('settingCommon.themeMode.light'),
        onClick: () => setTheme('light'),
      },
      {
        icon: <Icon icon={themeIcons.dark} />,
        key: 'dark',
        label: t('settingCommon.themeMode.dark'),
        onClick: () => setTheme('dark'),
      },
    ],
    [setTheme, t],
  );

  return (
    <DropdownMenu items={items} nativeButton={false} placement={placement}>
      <ActionIcon
        icon={themeIcons[(theme as 'dark' | 'light' | 'system') || 'system']}
        size={size || { blockSize: 32, size: 16 }}
      />
    </DropdownMenu>
  );
};

export default ThemeButton;
