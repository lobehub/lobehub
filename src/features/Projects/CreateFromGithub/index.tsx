import { createModal } from '@lobehub/ui';
import { lazy, Suspense } from 'react';
import { Trans } from 'react-i18next';

const CreateFromGithubContent = lazy(() => import('./Content'));

export const openCreateProjectFromGithubModal = () =>
  createModal({
    content: (
      <Suspense fallback={null}>
        <CreateFromGithubContent />
      </Suspense>
    ),
    footer: null,
    styles: { content: { padding: 0 } },
    title: <Trans i18nKey={'createFromGithub.title'} ns={'project'} />,
    width: 520,
  });
