import { type DropdownMenuCheckboxItem, type DropdownMenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ChevronRight, Languages } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

const LangButton = memo<{ placement?: DropdownMenuProps['placement']; size?: number }>(
  ({ placement, size }) => {
    const [language, switchLocale] = useGlobalStore((s) => [
      globalGeneralSelectors.language(s),
      s.switchLocale,
    ]);

    const { t } = useTranslation(['setting', 'common']);

    const items = useMemo<DropdownMenuCheckboxItem[]>(() => {
      const autoItem: DropdownMenuCheckboxItem = {
        checked: language === 'auto',
        closeOnClick: true,
        key: 'auto',
        label: (
          <Flexbox gap={4}>
            <Text style={{ lineHeight: 1.2 }}>{t('settingCommon.lang.autoMode')}</Text>
            <Text fontSize={12} style={{ lineHeight: 1.2 }} type={'secondary'}>
              {t(`lang.auto` as any, { ns: 'common' })}
            </Text>
          </Flexbox>
        ),
        onCheckedChange: (checked: boolean) => {
          if (checked) {
            switchLocale('auto');
          }
        },
        type: 'checkbox',
      };

      const localeItems = localeOptions.map<DropdownMenuCheckboxItem>((item) => ({
        checked: language === item.value,
        closeOnClick: true,
        key: item.value,
        label: (
          <Flexbox gap={4} key={item.value}>
            <Text style={{ lineHeight: 1.2 }}>{item.label}</Text>
            <Text fontSize={12} style={{ lineHeight: 1.2 }} type={'secondary'}>
              {t(`lang.${item.value}` as any, { ns: 'common' })}
            </Text>
          </Flexbox>
        ),
        onCheckedChange: (checked: boolean) => {
          if (checked) {
            switchLocale(item.value);
          }
        },
        type: 'checkbox',
      }));

      return [autoItem, ...localeItems];
    }, [language, switchLocale, t]);

    let trigger: ReactNode;

    if (size) {
      trigger = <ActionIcon icon={Languages} size={size} />;
    } else {
      trigger = (
        <Flexbox
          horizontal
          align="center"
          gap={12}
          style={{
            borderRadius: 8,
            boxSizing: 'content-box',
            cursor: 'pointer',
            height: 28,
            marginInline: 4,
            paddingBlock: 6,
            paddingInline: 12,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = cssVar.colorFillTertiary as string;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Icon icon={Languages} size={'small'} style={{ color: cssVar.colorTextSecondary }} />
          <Flexbox flex={1}>{t('settingCommon.lang.title')}</Flexbox>
          <Icon icon={ChevronRight} size={'small'} style={{ color: cssVar.colorTextSecondary }} />
        </Flexbox>
      );
    }

    return (
      <DropdownMenu
        items={items}
        placement={placement}
        trigger="hover"
        popupProps={{
          style: {
            maxHeight: 360,
            minWidth: 240,
            overflow: 'auto',
            transition: 'none',
          },
        }}
      >
        {trigger}
      </DropdownMenu>
    );
  },
);

export default LangButton;
