import { ActionIcon, Dropdown, type DropdownProps, Icon } from '@lobehub/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const themeIcons = {
  auto: Monitor,
  dark: Moon,
  light: Sun,
};

const ThemeButton: FC<{ placement?: DropdownProps['placement']; size?: number }> = ({
  placement,
  size,
}) => {
  const [themeMode, switchThemeMode] = useGlobalStore((s) => [
    systemStatusSelectors.themeMode(s),
    s.switchThemeMode,
  ]);

  const { t } = useTranslation('setting');

  const items: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={themeIcons.auto} />,
        key: 'auto',
        label: t('settingCommon.themeMode.auto'),
        onClick: () => switchThemeMode('auto'),
      },
      {
        icon: <Icon icon={themeIcons.light} />,
        key: 'light',
        label: t('settingCommon.themeMode.light'),
        onClick: () => switchThemeMode('light'),
      },
      {
        icon: <Icon icon={themeIcons.dark} />,
        key: 'dark',
        label: t('settingCommon.themeMode.dark'),
        onClick: () => switchThemeMode('dark'),
      },
    ],
    [t],
  );

  return (
    <Dropdown
      arrow={false}
      menu={{
        items,
        selectable: true,
        selectedKeys: [themeMode],
      }}
      placement={placement}
    >
      <ActionIcon icon={themeIcons[themeMode]} size={size || { blockSize: 32, size: 16 }} />
    </Dropdown>
  );
};

export default ThemeButton;
