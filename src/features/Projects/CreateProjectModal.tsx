import { createModal } from '@lobehub/ui/base-ui';
import { lazy, Suspense } from 'react';

import type { CreateProjectOptions } from './CreateProjectContent';

const CreateProjectContent = lazy(() => import('./CreateProjectContent'));
const CreateProjectTitle = lazy(() =>
  import('./CreateProjectContent').then((m) => ({ default: m.CreateProjectTitle })),
);

export const openCreateProjectModal = (options: CreateProjectOptions = {}) =>
  createModal({
    content: (
      <Suspense fallback={null}>
        <CreateProjectContent {...options} />
      </Suspense>
    ),
    footer: null,
    styles: { content: { padding: 0 } },
    title: (
      <Suspense fallback={null}>
        <CreateProjectTitle />
      </Suspense>
    ),
    width: 460,
  });
