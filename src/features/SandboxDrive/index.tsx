'use client';

import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { Button, Center, Flexbox, Icon, Spin, Tabs, Text } from '@lobehub/ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SandboxStorageUpgradeGuide } from '@/business/client/features/SandboxStorageUpsell';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { MAX_WIDTH } from '@/const/layoutTokens';
import { useSandboxDriveEntitlement } from '@/hooks/useSandboxDriveEntitlement';

import DriveExplorer from './DriveExplorer';
import DriveUsage from './DriveUsage';
import { useDriveTab } from './useDriveTab';

/**
 * The cloud sandbox's drives: what is on them, how much they hold, and — for
 * an account without one — the way to a plan that has one. The one place
 * storage is set out; the environments page keeps to definitions.
 *
 * A workspace has two drives, behind tabs: the public drive every member
 * browses and works in, and the member's own personal drive, which nobody
 * else can reach. A personal account has its personal drive alone. The open
 * drive lives in `?drive=public|personal`, so it survives a reload and links.
 */
const DriveSettings = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const workspaceId = useActiveWorkspaceId();
  const isWorkspace = !!workspaceId;
  const { entitled, error, retry } = useSandboxDriveEntitlement();
  const drives: SandboxDrive[] = isWorkspace ? ['public', 'personal'] : ['personal'];
  const [active, setActive] = useDriveTab(drives);

  // Whether the plan has a drive could not be read: say so and offer it
  // again, rather than a spinner that never resolves.
  if (entitled === undefined && error) {
    return (
      <Center gap={12} style={{ minHeight: 320 }}>
        <Text type={'secondary'}>{t('drive.loadFailed')}</Text>
        <Button onClick={retry}>{t('retry', { ns: 'common' })}</Button>
      </Center>
    );
  }

  if (entitled === undefined) {
    return (
      <Center style={{ minHeight: 320 }}>
        <Spin />
      </Center>
    );
  }

  if (!entitled) {
    return (
      <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
        <SandboxStorageUpgradeGuide />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12} style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      {/* A workspace's drives share one pool, so its meter sits beside the
          tabs that switch between them, not inside either drive. */}
      {isWorkspace && (
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
          <Flexbox flex={'none'}>
            <Tabs
              activeKey={active}
              items={drives.map((key) => ({
                icon: <Icon icon={key === 'public' ? UsersIcon : LockIcon} />,
                key,
                label: t(`drive.tabs.${key}`),
              }))}
              onChange={(key) => setActive(key as SandboxDrive)}
            />
          </Flexbox>
          <DriveUsage />
        </Flexbox>
      )}
      {/* Keyed on the drive, so a path browsed on one never carries to the other. */}
      <DriveExplorer
        drive={active}
        isWorkspace={isWorkspace}
        key={active}
        toolbarExtra={isWorkspace ? undefined : <DriveUsage />}
      />
    </Flexbox>
  );
});

DriveSettings.displayName = 'DriveSettings';

export default DriveSettings;
