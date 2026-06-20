import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { WORKSPACE_LIST_KEY } from '../hooks/useWorkspaces';

export default function WorkspaceGeneral() {
  const workspace = useActiveWorkspace();
  const { mutate } = useSWRConfig();
  const canManage = workspace?.role === 'owner' || workspace?.role === 'super_admin';
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState('');

  useEffect(() => {
    setDescription(workspace?.description ?? '');
    setName(workspace?.name ?? '');
    setSlug(workspace?.slug ?? '');
  }, [workspace]);

  if (!workspace)
    return <Text type="secondary">Выберите workspace для редактирования настроек.</Text>;

  const save = async () => {
    setSaving(true);
    try {
      await lambdaClient.workspace.update.mutate({ description, id: workspace.id, name, slug });
      await mutate(WORKSPACE_LIST_KEY);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16} style={{ maxWidth: 560 }}>
      <Flexbox gap={4}>
        <Text weight={600}>Название workspace</Text>
        <Input disabled={!canManage} value={name} onChange={(e) => setName(e.target.value)} />
      </Flexbox>
      <Flexbox gap={4}>
        <Text weight={600}>Slug</Text>
        <Input disabled={!canManage} value={slug} onChange={(e) => setSlug(e.target.value)} />
      </Flexbox>
      <Flexbox gap={4}>
        <Text weight={600}>Описание</Text>
        <Input
          disabled={!canManage}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>
      {canManage ? (
        <Button loading={saving} type="primary" onClick={save}>
          Сохранить изменения
        </Button>
      ) : (
        <Text type="secondary">Редактирование доступно владельцу workspace.</Text>
      )}
    </Flexbox>
  );
}
