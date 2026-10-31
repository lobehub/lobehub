'use client';

import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import { cx, DropdownMenu, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  chevron: { flexShrink: 0, color: cssVar.colorTextTertiary },
  logo: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  menu: { width: '176px', minWidth: '176px' },
  trigger: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    height: '28px',
    // Align the mark with the sidebar navigation icons below.
    marginInlineStart: '-4px',
    padding: 0,
    borderStyle: 'none',
    borderRadius: '8px',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
      '[data-popup-open]': cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
});

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
        className: stylex.props(styles.menu).className,
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
        className={cx(electronStylish.nodrag, stylex.props(styles.trigger).className)}
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
          <span {...stylex.props(styles.logo)}>
            <ProductLogo size={16} type={'mono'} />
            <ChevronDown aria-hidden className={stylex.props(styles.chevron).className} size={12} />
          </span>
        </Tooltip>
      </button>
    </DropdownMenu>
  );
});

WindowsAppMenu.displayName = 'WindowsAppMenu';

export default WindowsAppMenu;
