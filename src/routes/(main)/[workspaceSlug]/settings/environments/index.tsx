'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Flexbox, Icon, Tabs } from '@lobehub/ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { MAX_WIDTH } from '@/const/layoutTokens';
import EnvironmentManager from '@/features/EnvironmentManager';
import EnvironmentDetailPage from '@/features/EnvironmentManager/EnvironmentDetailPage';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

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
 *
 * The tabs are handed to the manager rather than rendered above it: they belong
 * on the same row as the actions, and the manager owns that row.
 *
 * The pool lives in `?visibility=` and one environment's page is
 * `environments/:sub`, so going back from it lands on the tab it is in.
 */
const WorkspaceEnvironmentsSetting = memo(() => {
  const { t } = useTranslation('setting');
  const { sub: environmentId } = useParams<{ sub?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const visibility: EnvironmentVisibility =
    searchParams.get('visibility') === 'private' ? 'private' : 'public';
  const navigate = useWorkspaceAwareNavigate();
  const query = visibility === 'private' ? '?visibility=private' : '';

  const setVisibility = (next: EnvironmentVisibility) =>
    setSearchParams(next === 'private' ? { visibility: next } : {}, { replace: true });

  if (environmentId)
    return (
      <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
        <EnvironmentDetailPage
          environmentId={environmentId}
          key={environmentId}
          visibility={visibility}
          onBack={() => navigate(`/settings/environments${query}`)}
        />
      </Flexbox>
    );

  return (
    <Flexbox style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
      {/* Keyed on the pool so a refresh in flight does not survive a tab switch. */}
      <EnvironmentManager
        key={visibility}
        visibility={visibility}
        tabs={
          <Tabs
            activeKey={visibility}
            // Tabs fill their container by default, which pushed the actions
            // onto a second row; size to the tabs so both share one.
            style={{ width: 'auto' }}
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
        }
        onOpenEnvironment={(id) =>
          navigate(`/settings/environments/${encodeURIComponent(id)}${query}`)
        }
      />
    </Flexbox>
  );
});

WorkspaceEnvironmentsSetting.displayName = 'WorkspaceEnvironmentsSetting';

export default WorkspaceEnvironmentsSetting;
