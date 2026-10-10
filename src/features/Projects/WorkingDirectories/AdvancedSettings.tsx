// FormKit migration is blocked on inline-validation support: `FormFieldProps` has no
// `help`/`validateStatus`, which this form uses for the slug field.
 
import { Button, confirmModal, Flexbox, Form, toast  } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export function AdvancedSettings({ project }: { project: ProjectDetail['project'] }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [pending, setPending] = useState(false);

  // Destructive settings stay owner-only; the page hides this tab for everyone else.
  if (currentUserId !== project.userId) return null;

  const confirmDelete = () => {
    confirmModal({
      title: t('list.deleteConfirmTitle'),
      content: t('list.deleteConfirmDescription', { name: project.name }),
      okText: t('delete', { ns: 'common' }),
      cancelText: t('cancel', { ns: 'common' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        setPending(true);
        try {
          await deleteProject(project.id);
          navigate('/projects', { replace: true });
        } catch (error) {
          console.error('Failed to delete project', error);
          toast.error(t('list.deleteError'));
          setPending(false);
          throw error;
        }
      },
    });
  };

  return (
    <Flexbox gap={24}>
      <Form
        {...FORM_STYLE}
        itemsType="flat"
        variant="filled"
        items={[
          {
            label: t('list.deleteAction'),
            desc: t('list.deleteConfirmDescription', { name: project.name }),
            minWidth: undefined,
            children: (
              <Button danger disabled={pending} onClick={confirmDelete}>
                {t('list.deleteAction')}
              </Button>
            ),
          },
        ]}
      />
    </Flexbox>
  );
}
