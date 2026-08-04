'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingRow from '../components/SettingRow';
import { HOME_WIDGET_KEYS, type HomeWidgetKey } from '../config';

export interface RightBarTabProps {
  isWidgetHidden: (key: HomeWidgetKey) => boolean;
  showPortrait: boolean;
  togglePortrait: () => void;
  toggleWidget: (key: HomeWidgetKey) => void;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  hairline: css`
    block-size: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
}));

const RightBarTab = memo<RightBarTabProps>(
  ({ showPortrait, togglePortrait, isWidgetHidden, toggleWidget }) => {
    const { t } = useTranslation('home');

    return (
      <Flexbox gap={20}>
        <Flexbox gap={4}>
          <Text as={'h2'} fontSize={16} weight={600}>
            {t('dashboard.customize.tab.rightBar')}
          </Text>
          <Text type={'secondary'}>{t('dashboard.customize.rightBar.desc')}</Text>
        </Flexbox>
        <SettingRow
          description={t('dashboard.customize.portrait.desc')}
          title={t('dashboard.customize.portrait.title')}
        >
          <Switch checked={showPortrait} onChange={togglePortrait} />
        </SettingRow>
        <div className={styles.hairline} />
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Text weight={600}>{t('dashboard.customize.widgets.title')}</Text>
            <Text type={'secondary'}>{t('dashboard.customize.widgets.desc')}</Text>
          </Flexbox>
          {HOME_WIDGET_KEYS.map((key) => (
            <SettingRow key={key} title={t(`dashboard.customize.widget.${key}`)}>
              <Switch checked={!isWidgetHidden(key)} onChange={() => toggleWidget(key)} />
            </SettingRow>
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default RightBarTab;
