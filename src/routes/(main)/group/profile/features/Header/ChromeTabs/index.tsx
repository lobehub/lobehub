'use client';

import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar: cv }) => ({
  addButton: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: 6px;

    color: ${cv.colorTextTertiary};

    background: transparent;

    transition: all 0.2s;

    &:hover {
      color: ${cv.colorTextSecondary};
      background: ${cv.colorFillTertiary};
    }
  `,
  container: css`
    display: flex;
    gap: 2px;
    align-items: center;
  `,
  externalTag: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 10px;
    line-height: 1.2;

    background: ${cv.colorFillSecondary};
  `,
  tab: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    height: 32px;
    padding-block: 6px;
    padding-inline: 12px;
    border-radius: 8px;

    color: ${cv.colorTextTertiary};

    background: transparent;

    transition: all 0.2s;

    &:hover {
      color: ${cv.colorTextSecondary};
      background: ${cv.colorFillTertiary};
    }
  `,
  tabActive: css`
    color: ${cv.colorText};
    background: ${cv.colorFillTertiary};

    &:hover {
      color: ${cv.colorText};
      background: ${cv.colorFillTertiary};
    }
  `,
  tabTitle: css`
    overflow: hidden;

    max-width: 120px;

    font-size: 13px;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export interface ChromeTabItem {
  avatar?: string;
  icon?: ReactNode;
  id: string;
  isExternal?: boolean;
  title: string;
}

interface ChromeTabsProps {
  activeId: string;
  items: ChromeTabItem[];
  onAdd?: () => void;
  onChange: (id: string) => void;
}

const ChromeTabs = memo<ChromeTabsProps>(({ items, activeId, onChange, onAdd }) => {
  const { t } = useTranslation('chat');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !activeId) return;

    const activeTab = containerRef.current.querySelector(`[data-tab-id="${activeId}"]`);
    if (!activeTab) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();

    const isVisible = tabRect.left >= containerRect.left && tabRect.right <= containerRect.right;

    if (!isVisible) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeId]);

  return (
    <div className={styles.container} ref={containerRef}>
      {items.map((item) => {
        const isActive = item.id === activeId;

        return (
          <div
            className={cx(styles.tab, isActive && styles.tabActive)}
            data-tab-id={item.id}
            key={item.id}
            onClick={() => onChange(item.id)}
          >
            <Flexbox horizontal align="center" gap={6}>
              {item.icon ? (
                item.icon
              ) : item.avatar ? (
                <Avatar avatar={item.avatar} size={18} />
              ) : null}
              <span className={styles.tabTitle}>{item.title}</span>
              {item.isExternal && (
                <span className={styles.externalTag}>{t('group.profile.external')}</span>
              )}
            </Flexbox>
          </div>
        );
      })}
      {onAdd && (
        <div className={styles.addButton} onClick={onAdd}>
          <Plus size={16} />
        </div>
      )}
    </div>
  );
});

export default ChromeTabs;
