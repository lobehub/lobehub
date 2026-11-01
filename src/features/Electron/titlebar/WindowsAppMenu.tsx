'use client';

import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import { createStaticStyles, cx, DropdownMenu, Tooltip } from '@lobehub/ui';
import { ChevronDown } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { electronSystemService } from '@/services/electron/system';
import { electronStylish } from '@/styles/electron';

import { toAppMenuDropdownItems } from './appMenuItems';
import {
  captureEditingTarget,
  type EditingTarget,
  isEditingMenuRole,
  restoreEditingTarget,
  runWhenMenuFocusSettles,
} from './editingFocus';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  logo: css`
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100%;
  `,
  menu: css`
    width: 176px;
    min-width: 176px;
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 44px;
    height: 28px;

    /* Align the mark with the sidebar navigation icons below. */
    margin-inline-start: -4px;
    padding: 0;
    border: none;
    border-radius: 8px;

    background: transparent;

    &:hover,
    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
}));

const WindowsAppMenu = memo(() => {
  const { t } = useTranslation('electron');
  const [nodes, setNodes] = useState<AppMenuNode[]>([]);
  const editingTargetRef = useRef<EditingTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const refresh = useCallback(() => {
    void electronSystemService.getAppMenu().then(setNodes, (error: unknown) => {
      console.error('Failed to load the app menu:', error);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const invoke = useCallback((id: string, role?: string) => {
    const send = () => {
      void electronSystemService.invokeAppMenuItem(id).catch((error: unknown) => {
        console.error('Failed to invoke app menu item:', error);
      });
    };

    if (!isEditingMenuRole(role)) {
      send();
      return;
    }

    const target = editingTargetRef.current;
    runWhenMenuFocusSettles(() => {
      restoreEditingTarget(target);
      send();
    });
  }, []);

  const items = useMemo(() => toAppMenuDropdownItems(nodes, invoke), [invoke, nodes]);

  return (
    <DropdownMenu
      iconSpaceMode={'group'}
      items={items}
      placement={'bottomLeft'}
      popupProps={{
        className: styles.menu,
        finalFocus: () => {
          const element = editingTargetRef.current?.element;
          return element?.isConnected ? element : true;
        },
      }}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) refresh();
      }}
    >
      <button
        aria-label={t('navigation.appMenu')}
        className={cx(electronStylish.nodrag, styles.trigger)}
        type={'button'}
        onPointerDown={() => {
          if (menuOpen) return;
          editingTargetRef.current = captureEditingTarget();
        }}
      >
        <Tooltip
          open={menuOpen ? false : undefined}
          placement={'bottomLeft'}
          title={t('navigation.appMenu')}
        >
          <span className={styles.logo}>
            <ProductLogo size={16} type={'mono'} />
            <ChevronDown aria-hidden className={styles.chevron} size={12} />
          </span>
        </Tooltip>
      </button>
    </DropdownMenu>
  );
});

WindowsAppMenu.displayName = 'WindowsAppMenu';

export default WindowsAppMenu;
