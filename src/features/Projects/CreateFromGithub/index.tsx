import { createModal } from '@lobehub/ui';
import { lazy, Suspense } from 'react';
import { Trans } from 'react-i18next';

const CreateFromGithubContent = lazy(() => import('./Content'));

export const openCreateProjectFromGithubModal = (provider: 'github' | 'tfs' = 'github') =>
  createModal({
    content: (
      <Suspense fallback={null}>
        <CreateFromGithubContent provider={provider} />
      </Suspense>
    ),
    footer: null,
    styles: { content: { padding: 0 } },
    title: (
      <Trans
        i18nKey={provider === 'tfs' ? 'createFromTfs.title' : 'createFromGithub.title'}
        ns={'project'}
      />
    ),
    width: 520,
  });
