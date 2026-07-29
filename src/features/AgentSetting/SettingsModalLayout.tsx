'use client';

import { ActionIcon, Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Tabs, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface SettingsModalTabItem {
  icon?: LucideIcon;
  key: string;
  label: ReactNode;
}

export interface SettingsModalLayoutProps {
  activeTab?: string;
  avatar: string;
  background?: string;
  children: ReactNode;
  onTabChange?: (key: string) => void;
  tabs?: SettingsModalTabItem[];
  title: ReactNode;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    flex-shrink: 0;
    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  tabsBar: css`
    flex-shrink: 0;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const SettingsModalLayout = memo<SettingsModalLayoutProps>(
  ({ avatar, background, title, tabs, activeTab, onTabChange, children }) => {
    const { t } = useTranslation('common');
    const { close } = useModalContext();

    const tabItems = tabs?.map(({ icon, key, label }) => ({
      icon: icon ? <Icon icon={icon} size={16} /> : undefined,
      key,
      label,
    }));

    return (
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
        <Flexbox horizontal align={'center'} className={styles.header} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Avatar avatar={avatar} background={background} shape={'square'} size={24} />
            <Text ellipsis weight={600}>
              {title}
            </Text>
          </Flexbox>
          <ActionIcon icon={XIcon} title={t('cancel')} onClick={close} />
        </Flexbox>

        {tabItems && tabItems.length >= 2 && (
          <Flexbox className={styles.tabsBar}>
            <Tabs activeKey={activeTab} items={tabItems} onChange={onTabChange} />
          </Flexbox>
        )}

        <Flexbox flex={1} paddingInline={16} style={{ minHeight: 0, overflow: 'auto' }}>
          {children}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default SettingsModalLayout;
