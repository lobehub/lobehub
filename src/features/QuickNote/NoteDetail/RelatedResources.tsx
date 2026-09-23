'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { QuickNoteResource } from '@/services/quickNote';

import ResourceRow from './ResourceRow';
import SectionLabel from './SectionLabel';
import { sortResources } from './sortResources';

const RelatedResources = memo<{ resources: QuickNoteResource[] }>(({ resources }) => {
  const { t } = useTranslation('note');

  if (resources.length === 0) return null;

  return (
    <Flexbox gap={8}>
      <SectionLabel count={resources.length} title={t('ai.related')} />
      {sortResources(resources).map((resource) => (
        <ResourceRow key={resource.id} resource={resource} />
      ))}
    </Flexbox>
  );
});

RelatedResources.displayName = 'QuickNoteRelatedResources';

export default RelatedResources;
