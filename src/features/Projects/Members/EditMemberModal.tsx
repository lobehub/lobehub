import { Button, createModal, Flexbox, Input, Text, TextArea, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useProjectStore } from '@/store/project';

interface EditMemberParams {
  agentId: string;
  projectId: string;
  responsibility?: string | null;
  role?: string | null;
  title: string;
}

function EditMemberContent({ agentId, projectId, responsibility, role }: EditMemberParams) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const updateProjectAgent = useProjectStore((s) => s.updateProjectAgent);
  const [nextRole, setRole] = useState(role ?? '');
  const [nextResponsibility, setResponsibility] = useState(responsibility ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();

  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      await updateProjectAgent(projectId, agentId, {
        responsibility: nextResponsibility.trim() || null,
        role: nextRole.trim() || null,
      });
      close();
    } catch (error) {
      console.error('Failed to update project agent', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text type="secondary">{t('members.editDescription')}</Text>
      <Flexbox gap={8}>
        <Text>{t('members.role')}</Text>
        <Input
          aria-label={t('members.role')}
          disabled={pending}
          maxLength={100}
          placeholder={t('members.rolePlaceholder')}
          value={nextRole}
          onChange={(e) => setRole(e.target.value)}
        />
      </Flexbox>
      <Flexbox gap={8}>
        <Text>{t('members.responsibility')}</Text>
        <TextArea
          aria-label={t('members.responsibility')}
          autoSize={{ maxRows: 8, minRows: 3 }}
          disabled={pending}
          maxLength={1000}
          placeholder={t('members.responsibilityPlaceholder')}
          value={nextResponsibility}
          onChange={(e) => setResponsibility(e.target.value)}
        />
      </Flexbox>
      {error ? (
        <AsyncError error={error} title={t('members.updateFailed')} variant="inline" />
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button loading={pending} type="primary" onClick={save}>
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export const openEditMemberModal = (params: EditMemberParams) =>
  createModal({
    content: <EditMemberContent {...params} />,
    footer: null,
    title: t('members.editTitle', { name: params.title, ns: 'project' }),
    width: 520,
  });
