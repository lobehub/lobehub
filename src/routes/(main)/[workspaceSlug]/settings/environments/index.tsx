'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentsGate from '@/features/EnvironmentManager/EnvironmentsGate';

/**
 * The workspace's environments, in two pools behind tabs — the same split the
 * workspace device page draws, for the same reason.
 *
 * - Workspace: what members have published. Running in one means running in its
 *   instances, which carry whatever a session left in them.
 * - Private: the caller's own, which is where every environment starts.
 *
 * The tab also decides where a new environment lands, so creating one from the
 * Private tab cannot quietly publish it.
 */
const WorkspaceEnvironmentsSetting = memo(() => {
  const { t } = useTranslation('setting');
  const [visibility, setVisibility] = useState<EnvironmentVisibility>('public');

  return (
    <Flexbox gap={16} style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      <EnvironmentsGate>
        <Tabs
          activeKey={visibility}
          items={[
            {
              icon: <Icon icon={UsersIcon} />,
              key: 'public',
              label: t('environments.visibility.tabs.workspace'),
            },
            {
              icon: <Icon icon={LockIcon} />,
              key: 'private',
              label: t('environments.visibility.tabs.private'),
            },
          ]}
          onChange={(key) => setVisibility(key as EnvironmentVisibility)}
        />
        {/* Keyed on the pool so the selected row and its open panel do not
            survive a tab switch — the environment they pointed at is not in
            the list any more. */}
        <EnvironmentManager key={visibility} visibility={visibility} />
      </EnvironmentsGate>
    </Flexbox>
  );
});

WorkspaceEnvironmentsSetting.displayName = 'WorkspaceEnvironmentsSetting';

export default WorkspaceEnvironmentsSetting;
