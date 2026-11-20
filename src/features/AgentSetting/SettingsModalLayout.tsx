'use client';

import { ActionIcon, Avatar, Flexbox, Icon, Tabs, Text, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type LucideIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useHeaderActionSize, useInterfaceDensity } from '@/styles/density';
import { densityTokens } from '@/styles/density.stylex';

export interface SettingsModalTabItem {
  icon?: LucideIcon;
  key: string;
  label: ReactNode;
}

export interface SettingsModalLayoutProps {
  activeTab?: string;
  /** Set for an agent's settings: the header draws an agent avatar seeded by this id. */
  agentId?: string;
  avatar: string;
  background?: string;
  children: ReactNode;
  onTabChange?: (key: string) => void;
  tabs?: SettingsModalTabItem[];
  title: ReactNode;
}

const styles = stylex.create({
  header: {
    flexShrink: 0,
    paddingBlock: '10px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  // 6px + the 28px close button = the 40px compact header height.
  headerCompact: {
    paddingBlock: '6px',
  },
  tabsBar: {
    flexShrink: 0,
    paddingInline: densityTokens['--lobe-density-content-gap'],
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

const SettingsModalLayout = memo<SettingsModalLayoutProps>(
  ({ agentId, avatar, background, title, tabs, activeTab, onTabChange, children }) => {
    const { t } = useTranslation('common');
    const { close } = useModalContext();
    const compact = useInterfaceDensity() === 'compact';
    // Loose keeps the ActionIcon default; compact takes the 28px header action.
    const headerActionSize = useHeaderActionSize();

    const tabItems = tabs?.map(({ icon, key, label }) => ({
      icon: icon ? <Icon icon={icon} size={16} /> : undefined,
      key,
      label,
    }));

    return (
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.header, compact && styles.headerCompact).className}
          justify={'space-between'}
        >
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            {agentId ? (
              <AgentAvatar
                agentId={agentId}
                avatar={avatar}
                background={background}
                name={typeof title === 'string' ? title : undefined}
                size={24}
              />
            ) : (
              <Avatar
                avatar={avatar}
                background={background}
                shape={'square'}
                size={24}
                title={typeof title === 'string' ? title : undefined}
              />
            )}
            <Text ellipsis weight={600}>
              {title}
            </Text>
          </Flexbox>
          <ActionIcon
            icon={XIcon}
            size={compact ? headerActionSize : undefined}
            title={t('cancel')}
            onClick={close}
          />
        </Flexbox>

        {tabItems && tabItems.length >= 2 && (
          <Flexbox className={stylex.props(styles.tabsBar).className}>
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
