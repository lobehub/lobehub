'use client';

import { Segmented } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessResourceCategories } from '@/business/client/features/ResourceCategories';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** Works types every deployment has; business types append after them. */
const WORK_TYPES = [
  { key: 'all', titleKey: 'docs.works.all', url: '/resource/works' },
  { key: 'task', titleKey: 'docs.works.task', url: '/resource/works?works=task' },
  { key: 'document', titleKey: 'docs.works.document', url: '/resource/works?works=document' },
] as const;

interface WorksTypeTabsProps {
  /** A `?works=` key (`all` / `task` / `document`) or a business category key. */
  activeKey: string;
}

/**
 * One Works section, many output types: the switch keeps Agent output in a
 * single place while each type keeps its own view and route.
 */
const WorksTypeTabs = memo<WorksTypeTabsProps>(({ activeKey }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const businessCategories = useBusinessResourceCategories();

  const options = useMemo(
    () => [
      ...WORK_TYPES.map((type) => ({
        label: t(type.titleKey),
        url: type.url,
        value: type.key as string,
      })),
      ...businessCategories.map((category) => ({
        // Business categories carry a `file` key typed as a plain string.
        label: t(category.titleKey as never) as string,
        url: category.url,
        value: category.key,
      })),
    ],
    [businessCategories, t],
  );

  // Narrower provider keys (linear / github) have no tab; they read as "All".
  const value = options.some((option) => option.value === activeKey) ? activeKey : 'all';

  return (
    <Segmented
      options={options.map(({ label, value }) => ({ label, value }))}
      size={'small'}
      value={value}
      onChange={(next) => {
        const target = options.find((option) => option.value === next);
        if (target) navigate(target.url, { replace: true });
      }}
    />
  );
});

WorksTypeTabs.displayName = 'WorksTypeTabs';

export default WorksTypeTabs;
