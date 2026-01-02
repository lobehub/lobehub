import { ActionIcon, Dropdown, type DropdownProps, Icon } from '@lobehub/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import { useIsDark } from '@/hooks/useIsDark';

const themeIcons = {
  auto: Monitor,
  dark: Moon,
  light: Sun,
};

const ThemeButton: FC<{ placement?: DropdownProps['placement']; size?: number }> = ({
  placement,
  size,
}) => {
  const { theme, setTheme } = useNextThemesTheme();
  const isDark = useIsDark();
  const { t } = useTranslation('setting');

  // Use the theme value from next-themes, default to 'system' (auto)
  const currentTheme = theme || 'system';

  const items: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={themeIcons.auto} />,
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

  // Use isDark for the icon display
  const displayTheme = isDark ? 'dark' : 'light';

  return (
    <Dropdown
      arrow={false}
      menu={{
        items,
        selectable: true,
        selectedKeys: [currentTheme],
      }}
      placement={placement}
    >
      <ActionIcon icon={themeIcons[displayTheme]} size={size || { blockSize: 32, size: 16 }} />
    </Dropdown>
  );
};

export default ThemeButton;
