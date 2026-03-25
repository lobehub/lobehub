'use client';

import { Button, FormGroup } from '@lobehub/ui';
import { Form, Input, Modal, Switch, Table, type TableColumnsType } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { sharedAgentService } from '@/services/sharedAgent';

type SharedAgent = {
  id: string;
  title?: string | null;
  description?: string | null;
  avatar?: string | null;
  model?: string | null;
  provider?: string | null;
  systemRole?: string | null;
  enabled: boolean;
  sort?: number | null;
};

type FormValues = Omit<SharedAgent, 'id' | 'enabled'>;

const SharedAgentsPage = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm<FormValues>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, mutate, isLoading } = useClientDataSWR('shared-agents-admin', () =>
    sharedAgentService.listAll(),
  );

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: SharedAgent) => {
    setEditingId(record.id);
    form.setFieldsValue({
      title: record.title,
      description: record.description,
      avatar: record.avatar,
      model: record.model,
      provider: record.provider,
      systemRole: record.systemRole,
      sort: record.sort,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editingId) {
        await sharedAgentService.update(editingId, values);
      } else {
        await sharedAgentService.create(values);
      }
      await mutate();
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await sharedAgentService.delete(id);
    await mutate();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await sharedAgentService.toggleEnabled(id, enabled);
    await mutate();
  };

  const columns: TableColumnsType<SharedAgent> = [
    { dataIndex: 'sort', title: t('sharedAgents.sort'), width: 60 },
    { dataIndex: 'title', title: t('sharedAgents.title') },
    { dataIndex: 'description', ellipsis: true, title: t('sharedAgents.description') },
    { dataIndex: 'model', title: t('sharedAgents.model') },
    {
      render: (_, record) => (
        <Switch checked={record.enabled} onChange={(checked) => handleToggle(record.id, checked)} />
      ),
      title: t('sharedAgents.enabled'),
      width: 80,
    },
    {
      render: (_, record) => (
        <>
          <Button size={'small'} onClick={() => openEdit(record)}>
            {t('sharedAgents.edit')}
          </Button>
          <Button
            danger
            size={'small'}
            style={{ marginLeft: 8 }}
            onClick={() => handleDelete(record.id)}
          >
            {t('sharedAgents.delete')}
          </Button>
        </>
      ),
      title: t('sharedAgents.actions'),
      width: 160,
    },
  ];

  return (
    <>
      <SettingHeader
        title={t('tab.sharedAgents')}
        extra={
          <Button type={'primary'} onClick={openCreate}>
            {t('sharedAgents.create')}
          </Button>
        }
      />
      <FormGroup collapsible={false} variant={'filled'}>
        <Table<SharedAgent>
          columns={columns}
          dataSource={data as SharedAgent[]}
          loading={isLoading}
          pagination={false}
          rowKey={'id'}
          size={'small'}
        />
      </FormGroup>
      <Modal
        confirmLoading={saving}
        open={modalOpen}
        title={editingId ? t('sharedAgents.editTitle') : t('sharedAgents.createTitle')}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
      >
        <Form form={form} layout={'vertical'}>
          <Form.Item label={t('sharedAgents.title')} name={'title'}>
            <Input />
          </Form.Item>
          <Form.Item label={t('sharedAgents.description')} name={'description'}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label={t('sharedAgents.avatar')} name={'avatar'}>
            <Input placeholder={'emoji or url'} />
          </Form.Item>
          <Form.Item label={t('sharedAgents.systemRole')} name={'systemRole'}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item label={t('sharedAgents.model')} name={'model'}>
            <Input />
          </Form.Item>
          <Form.Item label={t('sharedAgents.provider')} name={'provider'}>
            <Input />
          </Form.Item>
          <Form.Item label={t('sharedAgents.sort')} name={'sort'}>
            <Input type={'number'} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});

SharedAgentsPage.displayName = 'SharedAgentsPage';

export default SharedAgentsPage;
