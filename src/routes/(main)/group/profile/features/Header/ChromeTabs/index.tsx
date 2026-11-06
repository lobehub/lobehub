'use client';

import { type DropdownItem, DropdownMenu, Flexbox, Tooltip } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  addButton: {
    cursor: 'pointer',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'all 0.2s',
  },
  addButtonDisabled: {
    cursor: 'not-allowed',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorTextQuaternary },
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  container: { display: 'flex', gap: '2px', alignItems: 'center' },
  externalTag: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '4px',
    borderRadius: '4px',
    fontSize: '10px',
    lineHeight: 1.2,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  tab: {
    cursor: 'pointer',
    display: 'flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    height: '32px',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderRadius: '8px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'all 0.2s',
  },
  tabActive: {
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  tabTitle: {
    overflow: 'hidden',
    maxWidth: '120px',
    fontSize: '13px',
    lineHeight: 1.2,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export interface ChromeTabItem {
  avatar?: string;
  icon?: ReactNode;
  id: string;
  isExternal?: boolean;
  title: string;
}

interface ChromeTabsProps {
  activeId: string;
  addDisabled?: boolean;
  addDisabledReason?: string;
  /**
   * When provided, the add button becomes a dropdown trigger showing these items.
   * Otherwise it falls back to calling `onAdd` directly on click.
   */
  addMenuItems?: DropdownItem[];
  items: ChromeTabItem[];
  onAdd?: () => void;
  onChange: (id: string) => void;
}

const ChromeTabs = memo<ChromeTabsProps>(
  ({ items, activeId, onChange, onAdd, addMenuItems, addDisabled, addDisabledReason }) => {
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
      <div {...stylex.props(styles.container)} ref={containerRef}>
        {items.map((item) => {
          const isActive = item.id === activeId;

          return (
            <div
              {...stylex.props(styles.tab, isActive && styles.tabActive)}
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
                <span {...stylex.props(styles.tabTitle)}>{item.title}</span>
                {item.isExternal && (
                  <span {...stylex.props(styles.externalTag)}>{t('group.profile.external')}</span>
                )}
              </Flexbox>
            </div>
          );
        })}
        {(addMenuItems || onAdd) &&
          (addMenuItems ? (
            <DropdownMenu
              disabled={addDisabled}
              items={addMenuItems}
              nativeButton={false}
              placement="bottomLeft"
              trigger={['click']}
            >
              <div
                {...stylex.props(styles.addButton, addDisabled && styles.addButtonDisabled)}
                title={addDisabled ? addDisabledReason : undefined}
              >
                <Plus size={16} />
              </div>
            </DropdownMenu>
          ) : (
            <Tooltip title={addDisabled ? addDisabledReason : undefined}>
              <div
                {...stylex.props(styles.addButton, addDisabled && styles.addButtonDisabled)}
                onClick={() => {
                  if (addDisabled) return;
                  onAdd?.();
                }}
              >
                <Plus size={16} />
              </div>
            </Tooltip>
          ))}
      </div>
    );
  },
);

export default ChromeTabs;
