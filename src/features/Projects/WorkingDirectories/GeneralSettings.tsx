import { Flexbox, Input } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';

export function GeneralSettings({ project }: { project: ProjectDetail['project'] }) {
  const { t } = useTranslation('project');
  const [name, setName] = useState(project.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const updateProject = useProjectStore((s) => s.updateProject);
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      await updateProject(project.id, { name: name.trim() });
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
      {error ? <AsyncError error={error} onRetry={save} /> : null}
      <Flexbox horizontal justify="flex-end">
        <Button
          disabled={!name.trim() || name.trim() === project.name}
          loading={pending}
          type="primary"
          onClick={save}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
