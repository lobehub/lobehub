'use client';

import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { electronSystemService } from '@/services/electron/system';
import { electronStylish } from '@/styles/electron';

import { toAppMenuDropdownItems } from './appMenuItems';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
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

  const refresh = useCallback(() => {
    void electronSystemService.getAppMenu().then(setNodes, (error: unknown) => {
      console.error('Failed to load the app menu:', error);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const items = useMemo(() => {
    return toAppMenuDropdownItems(nodes, (id) => {
      void electronSystemService.invokeAppMenuItem(id).catch((error: unknown) => {
        console.error('Failed to invoke app menu item:', error);
      });
    });
  }, [nodes]);

  return (
    <DropdownMenu
      items={items}
      placement={'bottomLeft'}
      onOpenChange={(open) => {
        if (open) refresh();
      }}
    >
      <button
        aria-label={t('navigation.appMenu')}
        className={cx(electronStylish.nodrag, styles.trigger)}
        type={'button'}
      >
        <ProductLogo size={16} type={'mono'} />
      </button>
    </DropdownMenu>
  );
});

WindowsAppMenu.displayName = 'WindowsAppMenu';

export default WindowsAppMenu;
