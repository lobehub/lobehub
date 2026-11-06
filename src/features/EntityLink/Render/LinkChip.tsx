'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRightIcon } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';

const styles = stylex.create({
  chip: {
    color: { 'default': cssVar.colorLink, ':hover': cssVar.colorLinkHover },
    textDecoration: 'none',
    transition: 'color 0.15s',
  },
  icon: { display: 'inline-flex', marginInlineEnd: '4px', verticalAlign: '-0.15em' },
  sideBrowser: {
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'color 0.15s',
  },
  wrapper: { display: 'inline-flex', gap: '2px', alignItems: 'center' },
});

interface LinkChipProps {
  href?: string;
  icon?: ReactNode;
  label: string;
}

const isWebUrl = (href?: string) => !!href && /^https?:\/\//i.test(href);

const LinkChip = memo<LinkChipProps>(({ href, icon, label }) => {
  const { t } = useTranslation('chat');
  const openInBrowserTab = useGlobalStore((s) => s.openInBrowserTab);

  const openInSideBrowser = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      openInBrowserTab(href!);
    },
    [href, openInBrowserTab],
  );

  const link = (
    <a {...stylex.props(styles.chip)} href={href} rel="noopener noreferrer" target="_blank">
      {icon && <span {...stylex.props(styles.icon)}>{icon}</span>}
      {label}
    </a>
  );

  if (!isDesktop || !isWebUrl(href)) return link;

  return (
    <span {...stylex.props(styles.wrapper)}>
      {link}
      {/* Must stay OUTSIDE the anchor: the desktop preload matches clicks with
          `closest('a')` in the capture phase and stops propagation, so a button
          nested inside the link would never reach this onClick. */}
      <ActionIcon
        data-side-browser
        className={stylex.props(styles.sideBrowser).className}
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
