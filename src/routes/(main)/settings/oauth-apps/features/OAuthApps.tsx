'use client';

import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { authKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

import AppDetail from './AppDetail';
import AppItem from './AppItem';

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

  const {
    data: apps,
    isLoading,
    mutate,
  } = useClientDataSWR(authKeys.oauthAppList(), async () => {
    const list = await lambdaClient.oauthApp.list.query();
    return list as OAuthAppItem[];
  });

  const reload = () => mutate();

  if (params.sub)
    return (
      <AppDetail
        canEdit={canEdit}
        id={params.sub}
        onBack={() => navigate('/settings/oauth-apps')}
        onChanged={reload}
      />
    );

  const renderRows = () => {
    if (isLoading)
      return (
        <Flexbox gap={12} padding={12}>
          <Skeleton paragraph={{ rows: 2 }} title={false} />
          <Skeleton paragraph={{ rows: 2 }} title={false} />
        </Flexbox>
      );

    if (!apps?.length)
      return (
        <Flexbox align={'center'} gap={12} paddingBlock={40}>
          <Text type={'secondary'}>{t('oauthApp.list.empty')}</Text>
        </Flexbox>
      );

    return apps.map((app) => (
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
