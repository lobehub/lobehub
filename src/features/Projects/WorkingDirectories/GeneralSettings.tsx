import { Flexbox, Input, TextArea } from '@lobehub/ui';
import { Button, confirmModal, Text, toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { isProjectSlugValid } from '../createProjectForm';

export function GeneralSettings({ project }: { project: ProjectDetail['project'] }) {
  const { t } = useTranslation('project');
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const navigate = useWorkspaceAwareNavigate();
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const updateProject = useProjectStore((s) => s.updateProject);
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const saved = await updateProject(project.id, {
        name: name.trim(),
        slug: slug.trim() || null,
        description: description.trim() || null,
      });
      navigate(`/project/${saved.slug ?? saved.id}/settings/general`, { replace: true });
      toast.success(t('rename.success'));
    } catch (error) {
      console.error('Failed to update project', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Flexbox gap={20}>
      <Flexbox gap={6}>
        <Text fontSize={18} weight={600}>
          {t('settings.general')}
        </Text>
        <Text type="secondary">{t('settings.generalDescription')}</Text>
      </Flexbox>
      <Flexbox gap={8}>
        <Text>{t('create.nameLabel')}</Text>
        <Input
          aria-label={t('create.nameLabel')}
          disabled={pending}
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Flexbox>
      <Flexbox gap={8}>
        <Text>{t('settings.identifier')}</Text>
        <Input readOnly aria-label={t('settings.identifier')} value={project.identifier} />
        <Text type="secondary">{t('settings.identifierDescription')}</Text>
      </Flexbox>
      <Flexbox gap={8}>
        <Text>{t('create.slugLabel')}</Text>
        <Input
          aria-label={t('create.slugLabel')}
          disabled={pending}
          maxLength={100}
          status={isProjectSlugValid(slug) ? undefined : 'error'}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        <Text type={isProjectSlugValid(slug) ? 'secondary' : 'danger'}>
          {t(isProjectSlugValid(slug) ? 'settings.slugDescription' : 'create.slugInvalid')}
        </Text>
      </Flexbox>
      <Flexbox gap={8}>
        <Text>{t('settings.description')}</Text>
        <TextArea
          aria-label={t('settings.description')}
          disabled={pending}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>
      {error ? <AsyncError error={error} onRetry={save} /> : null}
      <Flexbox horizontal justify="flex-end">
        <Button
          loading={pending}
          type="primary"
          disabled={
            !name.trim() ||
            !isProjectSlugValid(slug) ||
            (name.trim() === project.name &&
              slug.trim() === (project.slug ?? '') &&
              description.trim() === (project.description ?? ''))
          }
          onClick={save}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
      {currentUserId === project.userId && (
        <Flexbox gap={12}>
          <Text weight={600}>{t('list.deleteAction')}</Text>
          <Text type="secondary">{t('list.deleteConfirmDescription', { name: project.name })}</Text>
          <Flexbox horizontal>
            <Button
              danger
              onClick={() =>
                confirmModal({
                  title: t('list.deleteConfirmTitle'),
                  content: t('list.deleteConfirmDescription', { name: project.name }),
                  okText: t('delete', { ns: 'common' }),
                  cancelText: t('cancel', { ns: 'common' }),
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    try {
                      await deleteProject(project.id);
                      navigate('/projects', { replace: true });
                    } catch (error) {
                      console.error('Failed to delete project', error);
                      toast.error(t('list.deleteError'));
                      throw error;
                    }
                  },
                })
              }
            >
              {t('list.deleteAction')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
}
