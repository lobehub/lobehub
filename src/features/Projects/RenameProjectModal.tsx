'use client';

import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProjectListItem } from '@/store/project';
import { useProjectStore } from '@/store/project';

interface RenameProjectContentProps {
  project: ProjectListItem;
}

const RenameProjectContent = ({ project }: RenameProjectContentProps) => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const updateProject = useProjectStore((s) => s.updateProject);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(project.name);
  const normalizedName = name.trim();

  const handleRename = async () => {
    if (!normalizedName || normalizedName === project.name || loading) return;
    setLoading(true);
    try {
      await updateProject(project.id, { name: normalizedName });
      close();
      toast.success(t('rename.success'));
    } catch (error) {
      console.error('Failed to rename project', error);
      toast.error(t('rename.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox gap={6} padding={16}>
        <Text fontSize={13} weight={500}>
          {t('rename.nameLabel')}
        </Text>
        <Input
          autoFocus
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={handleRename}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!normalizedName || normalizedName === project.name}
          loading={loading}
          type={'primary'}
          onClick={handleRename}
        >
          {t('rename.action')}
        </Button>
      </ModalFooter>
    </>
  );
};

export const openRenameProjectModal = (project: ProjectListItem) =>
  createModal({
    content: <RenameProjectContent project={project} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('rename.title', { ns: 'project' }),
    width: 420,
  });
