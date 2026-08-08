'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightIcon } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    color: ${cssVar.colorLink};
    text-decoration: none;
    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorLinkHover};
    }
  `,
  icon: css`
    display: inline-flex;
    margin-inline-end: 4px;
    vertical-align: -0.15em;
  `,
  sideBrowser: css`
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  `,
  wrapper: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;

    &:hover [data-side-browser],
    &:focus-within [data-side-browser] {
      pointer-events: auto;
      opacity: 1;
    }
  `,
}));

interface LinkChipProps {
  href?: string;
  icon?: ReactNode;
  label: string;
}

const isWebUrl = (href?: string) => !!href && /^https?:\/\//i.test(href);

const LinkChip = memo<LinkChipProps>(({ href, icon, label }) => {
  const { t } = useTranslation('chat');
  const openInBrowserTab = useGlobalStore((s) => s.openInBrowserTab);
  const enableInAppBrowser = useUserStore(labPreferSelectors.enableInAppBrowser);

  const openInSideBrowser = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      openInBrowserTab(href!);
    },
    [href, openInBrowserTab],
  );

  const link = (
    <a className={styles.chip} href={href} rel="noopener noreferrer" target="_blank">
      {icon && <span className={styles.icon}>{icon}</span>}
      {label}
    </a>
  );

  if (!isDesktop || !enableInAppBrowser || !isWebUrl(href)) return link;

  return (
    <span className={styles.wrapper}>
      {link}
      {/* Must stay OUTSIDE the anchor: the desktop preload matches clicks with
          `closest('a')` in the capture phase and stops propagation, so a button
          nested inside the link would never reach this onClick. */}
      <ActionIcon
        data-side-browser
        className={styles.sideBrowser}
        icon={PanelRightIcon}
        size={'small'}
        title={t('messageLink.openInSideBrowser')}
        onClick={openInSideBrowser}
      />
    </span>
  );
});

LinkChip.displayName = 'LinkChip';

export default LinkChip;
