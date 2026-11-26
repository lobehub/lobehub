// FormKit migration is blocked on inline-validation support: `FormFieldProps` has no
// `help`/`validateStatus`, which this form uses for the slug field.

import { Button, Flexbox, Form, Text, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';
import { useDensityTokens } from '@/styles/density';

import { createDeleteProjectModal } from '../DeleteProjectModal';
import { useProjectLinearSync } from '../LinearSync';
import { SitesSettings } from '../Review/SitesSettings';
import { useCanManageProject } from '../useCanManageProject';

type Project = ProjectDetail['project'];

/**
 * Sites follow the project review role (the server checks it), so every member
 * sees them here. Linear sync and deleting the project need edit permission and
 * stay hidden from viewers; the destructive action comes last.
 */
export function AdvancedSettings({ project }: { project: Project }) {
  const canManage = useCanManageProject();

  return (
    <Flexbox gap={32}>
      <SitesSettings projectId={project.id} />
      {canManage && <ManagementSettings project={project} />}
    </Flexbox>
  );
}

function ManagementSettings({ project }: { project: Project }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [pending, setPending] = useState(false);
  const linearSync = useProjectLinearSync(project.id);
  const { pageTitleFontSize } = useDensityTokens();

  const confirmDelete = () => {
    createDeleteProjectModal({
      onConfirm: async () => {
        setPending(true);
        try {
          await deleteProject(project.id);
        } catch (error) {
          setPending(false);
          throw error;
        }
        toast.success(t('list.deleteSuccess', { name: project.name }));
        navigate('/projects', { replace: true });
      },
      project: { id: project.id, name: project.name },
    });
  };

  return (
    <Flexbox gap={24}>
      <Flexbox gap={6}>
        <Text fontSize={pageTitleFontSize} weight={600}>
          {t('settings.management')}
        </Text>
        <Text type="secondary">{t('settings.managementDescription')}</Text>
      </Flexbox>
      {linearSync.item ? (
        <Flexbox gap={16}>
          <Form {...FORM_STYLE} items={[linearSync.item]} itemsType="flat" variant="filled" />
          {linearSync.rules}
        </Flexbox>
      ) : (
        linearSync.rules
      )}
      <Form
        {...FORM_STYLE}
        itemsType="flat"
        variant="filled"
        items={[
          {
            label: t('list.deleteAction'),
            desc: t('delete.description'),
            minWidth: undefined,
            children: (
              <Button danger loading={pending} type="primary" onClick={confirmDelete}>
                {t('list.deleteAction')}
              </Button>
            ),
          },
        ]}
      />
    </Flexbox>
  );
}
