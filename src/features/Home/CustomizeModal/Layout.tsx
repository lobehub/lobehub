'use client';

import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { type LucideIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface CustomizeModalTab {
  icon: LucideIcon;
  key: string;
  label: string;
}

export interface LayoutProps {
  activeTab: string;
  children: ReactNode;
  onReset: () => void;
  onTabChange: (key: string) => void;
  tabs: CustomizeModalTab[];
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  shell: css`
    display: flex;
    min-height: 520px;
  `,
  rail: css`
    display: flex;
    flex: none;
    flex-direction: column;

    width: 220px;
    padding: 12px;

    background: ${cssVar.colorFillQuaternary};
  `,
  tabRow: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    height: 36px;
    padding-inline: 10px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: inherit;
    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  tabRowActive: css`
    font-weight: 500;
    background: ${cssVar.colorBgElevated};

    &:hover {
      background: ${cssVar.colorBgElevated};
    }
  `,
  railSpacer: css`
    flex: 1;
  `,
  pane: css`
    position: relative;

    overflow-y: auto;
    flex: 1;

    min-width: 0;
    padding-block: 20px;
    padding-inline: 24px;
  `,
  closeButton: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 12px;
  `,
}));

const Layout = memo<LayoutProps>(({ tabs, activeTab, onTabChange, onReset, children }) => {
  const { t } = useTranslation('home');
  const { t: commonT } = useTranslation('common');
  const { close } = useModalContext();

  return (
    <div className={styles.shell}>
      <div className={styles.rail}>
        <Flexbox gap={2}>
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                aria-current={isActive ? 'page' : undefined}
                className={cx(styles.tabRow, isActive && styles.tabRowActive)}
                key={tab.key}
                type={'button'}
                onClick={() => onTabChange(tab.key)}
              >
                <Icon icon={tab.icon} size={16} />
                <Text ellipsis>{tab.label}</Text>
              </button>
            );
          })}
        </Flexbox>
        <div className={styles.railSpacer} />
        <Button block type={'text'} onClick={onReset}>
          {t('dashboard.customize.reset')}
        </Button>
      </div>
      <div className={styles.pane}>
        <ActionIcon
          className={styles.closeButton}
          icon={XIcon}
          title={commonT('cancel')}
          onClick={close}
        />
        {children}
      </div>
    </div>
  );
});

export default Layout;
