import { type DropdownMenuCheckboxItem, type DropdownMenuProps } from '@lobehub/ui';
import { DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ChevronRight, GlobeIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { electronStylish } from '@/styles/electron';
import { preloadLang } from '@/utils/client/preloadLang';

import { getLanguageDisplayLabel } from './getLanguageDisplayLabel';

const LangButton = memo<{ compact?: boolean; placement?: DropdownMenuProps['placement'] }>(
  ({ compact, placement }) => {
    const [language, currentLanguage, switchLocale] = useGlobalStore((s) => [
      globalGeneralSelectors.language(s),
      globalGeneralSelectors.currentLanguage(s),
      s.switchLocale,
    ]);

    const { t } = useTranslation(['setting', 'common']);
    const currentLabel = getLanguageDisplayLabel(
      language,
      currentLanguage,
      t('settingCommon.lang.autoMode'),
    );

    const items = useMemo<DropdownMenuCheckboxItem[]>(() => {
      const autoItem: DropdownMenuCheckboxItem = {
        checked: language === 'auto',
        closeOnClick: true,
        key: 'auto',
        label: (
          <Flexbox gap={4} onMouseEnter={() => preloadLang('auto')}>
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
          <Flexbox gap={4} key={item.value} onMouseEnter={() => preloadLang(item.value)}>
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

    if (compact) {
      trigger = (
        <Button
          icon={GlobeIcon}
          iconPosition="end"
          size="small"
          type="text"
          style={{
            height: 32,
            paddingInline: 8,
          }}
        >
          <Text fontSize={12}>{currentLabel}</Text>
        </Button>
      );
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
          <Flexbox flex={1}>{currentLabel}</Flexbox>
          <Icon icon={GlobeIcon} size={'small'} style={{ color: cssVar.colorTextSecondary }} />
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
          className: electronStylish.nodrag,
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
