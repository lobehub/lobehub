import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { copyToClipboard, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import {
  ArrowRightIcon,
  ChevronDownIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  LinkIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import { useGitRemoteBranches } from '@/store/device';

import { rowStyles } from '../Overview/OverviewRow';
import { sectionStyles } from '../Overview/sectionStyles';
import { getDetailVisual } from './prVisual';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    flex-shrink: 0;
    margin-block-start: -2px;
  `,
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
  refButton: css`
    cursor: pointer;
    display: inline-flex;
    gap: 3px;
    align-items: center;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  stats: css`
    font-variant-numeric: tabular-nums;
  `,
  title: css`
    flex: 1;

    min-width: 0;

    font-size: 15px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
}));

interface HeaderProps {
  detail: DeviceGitPullRequestDetail;
  deviceId?: string;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  workingDirectory: string;
}

const Header = memo<HeaderProps>(({ detail, deviceId, onAction, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const visual = getDetailVisual(detail);
  const canChangeBase = detail.viewerCanWrite && detail.state === 'open';
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const { data: remoteBranches } = useGitRemoteBranches(
    workingDirectory,
    canChangeBase && basePickerOpen,
    deviceId,
  );
  const baseItems: DropdownItem[] = remoteBranches
    ? remoteBranches
        .map((branch) => branch.name.replace(/^[^/]+\//, ''))
        .filter((name) => name !== detail.headRefName)
        .map((name) => ({
          key: name,
          label: name,
          onClick: () => {
            if (name !== detail.baseRefName) void onAction({ base: name, type: 'changeBase' });
          },
        }))
    : [{ disabled: true, key: 'loading', label: t('workingPanel.review.baseRef.loading') }];

  const openOnGithub = () => void electronSystemService.openExternalLink(detail.url);

  const menuItems: DropdownItem[] = [
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
        <Flexbox horizontal className={styles.actions} gap={2}>
          <ActionIcon
            icon={ExternalLinkIcon}
            size={'small'}
            title={t('workingPanel.pr.menu.openOnGithub')}
            onClick={openOnGithub}
          />
          <DropdownMenu items={menuItems} placement={'bottomRight'}>
            <ActionIcon icon={EllipsisIcon} size={'small'} />
          </DropdownMenu>
        </Flexbox>
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
        {canChangeBase ? (
          <DropdownMenu
            virtual
            items={baseItems}
            placement={'bottomLeft'}
            onOpenChange={setBasePickerOpen}
          >
            <span
              className={cx(styles.ref, styles.refButton)}
              role={'button'}
              tabIndex={0}
              title={t('workingPanel.pr.header.changeBase')}
            >
              {detail.baseRefName}
              <Icon icon={ChevronDownIcon} size={10} />
            </span>
          </DropdownMenu>
        ) : (
          <span className={styles.ref} title={detail.baseRefName}>
            {detail.baseRefName}
          </span>
        )}
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
