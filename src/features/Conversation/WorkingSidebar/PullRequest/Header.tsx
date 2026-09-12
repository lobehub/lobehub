import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { copyToClipboard, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRightIcon, EllipsisIcon, ExternalLinkIcon, LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

import { rowStyles } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import { getDetailVisual } from './prVisual';

const styles = createStaticStyles(({ css, cssVar }) => ({
  head: css`
    padding-block: 10px 8px;
    padding-inline: 8px;
  `,
  meta: css`
    flex-wrap: wrap;

    margin-block-start: 6px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  ref: css`
    overflow: hidden;

    max-width: 160px;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillSecondary};
  `,
  stats: css`
    font-variant-numeric: tabular-nums;
  `,
  title: css`
    flex: 1;

    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-wrap: balance;
  `,
}));

interface HeaderProps {
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
}

const Header = memo<HeaderProps>(({ detail, onAction }) => {
  const { t } = useTranslation('chat');
  const visual = getDetailVisual(detail);

  const menuItems: DropdownItem[] = [
    {
      icon: <Icon icon={ExternalLinkIcon} size={14} />,
      key: 'open',
      label: t('workingPanel.pr.menu.openOnGithub'),
      onClick: () => void electronSystemService.openExternalLink(detail.url),
    },
    {
      icon: <Icon icon={LinkIcon} size={14} />,
      key: 'copy',
      label: t('workingPanel.pr.menu.copyLink'),
      onClick: async () => {
        await copyToClipboard(detail.url);
        toast.success(t('workingPanel.pr.menu.copied'));
      },
    },
    ...(detail.viewerCanWrite && detail.state !== 'merged'
      ? [
          { type: 'divider' as const },
          detail.state === 'open'
            ? {
                danger: true,
                key: 'close',
                label: t('workingPanel.pr.menu.close'),
                onClick: () => void onAction({ type: 'close' }),
              }
            : {
                key: 'reopen',
                label: t('workingPanel.pr.menu.reopen'),
                onClick: () => void onAction({ type: 'reopen' }),
              },
        ]
      : []),
  ];

  return (
    <div className={styles.head}>
      <Flexbox horizontal align={'flex-start'} gap={6}>
        <span className={styles.title}>
          <span className={rowStyles.num}>#{detail.number}</span>
          {detail.title}
        </span>
        <DropdownMenu items={menuItems} placement={'bottomRight'}>
          <ActionIcon icon={EllipsisIcon} size={'small'} />
        </DropdownMenu>
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.meta} gap={6}>
        <span
          className={sectionStyles.pill}
          style={{
            background: `color-mix(in srgb, ${visual.color} 12%, transparent)`,
            color: visual.color,
          }}
        >
          <Icon icon={visual.icon} size={12} />
          {t(`workingPanel.pr.state.${visual.state}`)}
        </span>
        <span className={styles.ref} title={detail.headRefName}>
          {detail.headRefName}
        </span>
        <Icon icon={ArrowRightIcon} size={11} />
        <span className={styles.ref} title={detail.baseRefName}>
          {detail.baseRefName}
        </span>
        <span>· {t('workingPanel.pr.header.commits', { count: detail.commits.length })}</span>
        <span className={styles.stats}>
          <span className={rowStyles.changeAdditions}>+{detail.additions}</span>{' '}
          <span className={rowStyles.changeDeletions}>−{detail.deletions}</span>
        </span>
      </Flexbox>
    </div>
  );
});

Header.displayName = 'PullRequestHeader';

export default Header;
