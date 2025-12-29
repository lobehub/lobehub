import { ActionIcon, Dropdown, DropdownProps, Flexbox, Text } from '@lobehub/ui';
import { Languages } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { type LocaleMode } from '@/types/locale';

const LangButton = memo<{ placement?: DropdownProps['placement']; size?: number }>(
  ({ placement, size }) => {
    const [language, switchLocale] = useGlobalStore((s) => [
      globalGeneralSelectors.language(s),
      s.switchLocale,
    ]);

    const handleLangChange = (value: LocaleMode) => {
      switchLocale(value);
    };

    const { t } = useTranslation(['setting', 'common']);

    const items: MenuProps['items'] = useMemo(
      () => [
        {
          key: 'auto',
          label: (
            <Flexbox gap={4}>
              <Text style={{ lineHeight: 1.2 }}>{t('settingCommon.lang.autoMode')}</Text>
              <Text fontSize={12} style={{ lineHeight: 1.2 }} type={'secondary'}>
                {t(`lang.auto` as any, { ns: 'common' })}
              </Text>
            </Flexbox>
          ),
          onClick: () => handleLangChange('auto'),
        },
        ...localeOptions.map((item) => ({
          key: item.value,
          label: (
            <Flexbox gap={4} key={item.value}>
              <Text style={{ lineHeight: 1.2 }}>{item.label}</Text>
              <Text fontSize={12} style={{ lineHeight: 1.2 }} type={'secondary'}>
                {t(`lang.${item.value}` as any, { ns: 'common' })}
              </Text>
            </Flexbox>
          ),
          onClick: () => handleLangChange(item.value),
        })),
      ],
      [t],
    );

    return (
      <Dropdown
        arrow={false}
        menu={{
          items,
          selectable: true,
          selectedKeys: [language],
          style: {
            maxHeight: 360,
            minWidth: 240,
            overflow: 'auto',
          },
        }}
        placement={placement}
      >
        <ActionIcon icon={Languages} size={size || { blockSize: 32, size: 16 }} />
      </Dropdown>
    );
  },
);

export default LangButton;
