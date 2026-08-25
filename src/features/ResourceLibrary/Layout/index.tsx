'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import RegisterHotkeys from '@/features/ResourceLibrary/RegisterHotkeys';
import { useKnowledgeBaseItem } from '@/features/ResourceManager/hooks/useKnowledgeItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isForbiddenError } from '@/utils/forbiddenError';

import Sidebar from './Sidebar';
import { styles } from './style';

const LibraryLayout: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  // Same SWR key as the page content's fetch, so this costs no extra request.
  const { error } = useKnowledgeBaseItem(id || '');

  // A restricted KB (resource-permission `use` level) 403s for members. Catch
  // it at the layout so the route shows one error page in the content area
  // (the nav slot stays an idle skeleton), instead of the sidebar and the
  // content each rendering their own error card. Retrying can never succeed,
  // so the action slot carries the way back instead of a retry button.
  if (error && isForbiddenError(error)) {
    return (
      <AsyncError
        error={error}
        variant={'page'}
        action={
          <Button size={'small'} onClick={() => navigate('/resource', { replace: true })}>
            {t('library.backToResources')}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Sidebar />
      <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
        <Outlet />
      </Flexbox>
      <RegisterHotkeys />
    </>
  );
};

export default LibraryLayout;
