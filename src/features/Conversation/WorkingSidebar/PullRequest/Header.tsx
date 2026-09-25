import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { copyToClipboard, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
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
import PrHead, { headStyles, PrStatePill, PrTitle } from './Head';

interface HeaderProps {
  activityLoaded?: boolean;
  detail: DeviceGitPullRequestDetail;
  deviceId?: string;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  workingDirectory: string;
}

const Header = memo<HeaderProps>(
  ({ activityLoaded = true, detail, deviceId, onAction, workingDirectory }) => {
    const { t } = useTranslation('chat');
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
      <PrHead
        title={<PrTitle number={detail.number} title={detail.title} />}
        actions={
          <>
            <ActionIcon
              icon={ExternalLinkIcon}
              size={'small'}
              title={t('workingPanel.pr.menu.openOnGithub')}
              onClick={openOnGithub}
            />
            <DropdownMenu items={menuItems} placement={'bottomRight'}>
              <ActionIcon icon={EllipsisIcon} size={'small'} />
            </DropdownMenu>
          </>
        }
        meta={
          <>
            <PrStatePill pr={detail} />
            <span className={headStyles.ref} title={detail.headRefName}>
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
                  className={cx(headStyles.ref, headStyles.refButton)}
                  role={'button'}
                  tabIndex={0}
                  title={t('workingPanel.pr.header.changeBase')}
                >
                  {detail.baseRefName}
                  <Icon icon={ChevronDownIcon} size={10} />
                </span>
              </DropdownMenu>
            ) : (
              <span className={headStyles.ref} title={detail.baseRefName}>
                {detail.baseRefName}
              </span>
            )}
            {activityLoaded && (
              <span>· {t('workingPanel.pr.header.commits', { count: detail.commits.length })}</span>
            )}
            <span className={headStyles.stats}>
              <span className={rowStyles.changeAdditions}>+{detail.additions}</span>{' '}
              <span className={rowStyles.changeDeletions}>−{detail.deletions}</span>
            </span>
          </>
        }
      />
    );
  },
);

Header.displayName = 'PullRequestHeader';

export default Header;
