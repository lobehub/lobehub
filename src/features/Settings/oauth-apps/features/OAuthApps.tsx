'use client';

import { createStaticStyles, Empty, Flexbox } from '@lobehub/ui';
import { AppWindowIcon } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { resolveAppListState } from '../appList';
import AppDetail from './AppDetail';
import AppItem from './AppItem';
import { AppRowsSkeleton } from './AppListSkeleton';
import CreateAppButton from './CreateAppButton';
import { useOAuthAppList } from './useOAuthAppList';

const styles = createStaticStyles(({ css, cssVar }) => ({
  listCol: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

interface OAuthAppsProps {
  canEdit: boolean;
}

const OAuthApps: FC<OAuthAppsProps> = ({ canEdit }) => {
  const { t } = useTranslation('auth');
  const navigate = useWorkspaceAwareNavigate();
  const params = useParams<{ sub?: string }>();

  const { data: apps, error, isLoading, isValidating, mutate } = useOAuthAppList();

  const reload = () => mutate();

  if (params.sub)
    return (
      <AppDetail
        canEdit={canEdit}
        id={params.sub}
        key={params.sub}
        onBack={() => navigate('/settings/oauth-apps')}
        onChanged={reload}
      />
    );

  const listState = resolveAppListState({ count: apps?.length, error, isLoading });

  if (listState === 'error')
    return <AsyncError error={error} retrying={isValidating} variant={'block'} onRetry={reload} />;

  // A small list the user builds themselves: the empty state sits in place,
  // unframed, and owns the page's one primary action (the header hides its
  // Create button meanwhile).
  if (listState === 'empty' || (listState === 'list' && !apps))
    return (
      <Empty
        action={canEdit && <CreateAppButton />}
        description={t('oauthApp.list.empty')}
        // The default 34ch cap breaks the one-sentence CJK copy mid-word.
        descriptionProps={{ style: { maxWidth: '48ch' } }}
        icon={AppWindowIcon}
        style={{ paddingBlock: 64 }}
        title={t('oauthApp.list.emptyTitle')}
      />
    );

  const renderRows = () => {
    if (listState === 'loading') return <AppRowsSkeleton />;

    return apps?.map((app) => (
      <AppItem
        app={app}
        canEdit={canEdit}
        key={app.id}
        onChanged={reload}
        onDeleted={reload}
        onOpen={() => navigate(`/settings/oauth-apps/${app.id}`)}
      />
    ));
  };

  return (
    <Flexbox className={styles.listCol} gap={2} padding={4}>
      {renderRows()}
    </Flexbox>
  );
};

export default OAuthApps;
