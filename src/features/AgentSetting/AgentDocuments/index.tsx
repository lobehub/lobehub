'use client';

import type { TableColumnsType } from 'antd';
import { App, Button, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';

interface AgentDocumentItem {
  filename: string;
  id: string;
  templateId: string | null;
  title: string;
}

interface TemplateItem {
  description?: string;
  filenames: string[];
  id: string;
  name: string;
}

const DEFAULT_TEMPLATE_ID = 'claw';
const FILE_PREVIEW_LIMIT = 5;

const AgentDocuments = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { message, modal } = App.useApp();
  const agentId = useAgentStore((s) => s.activeAgentId);
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [isInitializingTemplate, setIsInitializingTemplate] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const {
    data: documents = [],
    isLoading: isDocumentsLoading,
    mutate: mutateDocuments,
  } = useClientDataSWR<AgentDocumentItem[]>(
    agentId ? ([`agent-documents`, agentId] as const) : null,
    async ([, id]: readonly [string, string]) => agentDocumentService.getDocuments({ agentId: id }),
  );

  const { data: templates = [], isLoading: isTemplatesLoading } = useClientDataSWR<TemplateItem[]>(
    'agent-document-templates',
    () => agentDocumentService.getTemplates(),
  );

  const templateOptions = useMemo(
    () =>
      templates
        .filter((item) => item.filenames.length > 0)
        .map((item) => ({ label: item.name, title: item.description, value: item.id })),
    [templates],
  );

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId),
    [templateId, templates],
  );

  const templateSummary = useMemo(() => {
    const templateFilenames = selectedTemplate?.filenames ?? [];
    const existingFilenames = new Set(documents.map((item) => item.filename));
    const overwrittenFilenames = templateFilenames.filter((filename) =>
      existingFilenames.has(filename),
    );

    return {
      createdCount: templateFilenames.length - overwrittenFilenames.length,
      overwrittenCount: overwrittenFilenames.length,
      overwrittenFilenames,
      templateFilenames,
    };
  }, [documents, selectedTemplate]);

  const removeDocument = async (id: string) => {
    if (!agentId) return;

    try {
      setDeletingDocumentId(id);
      await agentDocumentService.removeDocument({ agentId, id });
      await mutateDocuments();
      message.success(t('agentDocuments.deleteSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setDeletingDocumentId((currentId) => (currentId === id ? null : currentId));
    }
  };

  const columns: TableColumnsType<AgentDocumentItem> = [
    {
      dataIndex: 'title',
      key: 'title',
      render: (_: unknown, item) => (
        <Space direction={'vertical'} size={0}>
          <Typography.Text strong>{item.title || item.filename}</Typography.Text>
          <Typography.Text type={'secondary'}>{item.filename}</Typography.Text>
        </Space>
      ),
      title: t('agentDocuments.columns.document'),
    },
    {
      dataIndex: 'templateId',
      key: 'templateId',
      render: (value: unknown) => (typeof value === 'string' && value ? <Tag>{value}</Tag> : null),
      title: t('agentDocuments.columns.template'),
      width: 160,
    },
    {
      key: 'actions',
      render: (_, item) => (
        <Popconfirm
          key={`delete-${item.id}`}
          okButtonProps={{ loading: deletingDocumentId === item.id }}
          title={t('agentDocuments.deleteConfirm')}
          onConfirm={() => removeDocument(item.id)}
        >
          <Button danger loading={deletingDocumentId === item.id} type={'link'}>
            {t('delete', { ns: 'common' })}
          </Button>
        </Popconfirm>
      ),
      title: t('agentDocuments.columns.actions'),
      width: 120,
    },
  ];

  const initializeTemplate = async () => {
    if (!agentId) return;

    try {
      setIsInitializingTemplate(true);
      await agentDocumentService.initializeFromTemplate({
        agentId,
        templateSet: templateId,
      });
      await mutateDocuments();
      message.success(t('agentDocuments.createSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to apply template');
    } finally {
      setIsInitializingTemplate(false);
    }
  };

  const confirmInitializeTemplate = () => {
    if (!selectedTemplate) return;

    const { createdCount, overwrittenCount, overwrittenFilenames } = templateSummary;

    if (overwrittenCount === 0) {
      void initializeTemplate();
      return;
    }

    const previewFilenames = overwrittenFilenames.slice(0, FILE_PREVIEW_LIMIT);
    const remainingCount = overwrittenCount - previewFilenames.length;

    modal.confirm({
      content: (
        <Space direction={'vertical'} size={8}>
          <Typography.Text>
            {t('agentDocuments.overwriteConfirm.summary', {
              createCount: createdCount,
              overwriteCount: overwrittenCount,
              templateName: selectedTemplate.name,
            })}
          </Typography.Text>
          <Typography.Text type={'secondary'}>
            {t('agentDocuments.overwriteConfirm.warning')}
          </Typography.Text>
          {previewFilenames.length > 0 ? (
            <Space direction={'vertical'} size={4}>
              {previewFilenames.map((filename) => (
                <Typography.Text code key={filename}>
                  {filename}
                </Typography.Text>
              ))}
              {remainingCount > 0 ? (
                <Typography.Text type={'secondary'}>
                  {t('agentDocuments.overwriteConfirm.more', { count: remainingCount })}
                </Typography.Text>
              ) : null}
            </Space>
          ) : null}
        </Space>
      ),
      okButtonProps: { danger: true },
      okText: t('agentDocuments.overwriteConfirm.confirm'),
      onOk: async () => initializeTemplate(),
      title: t('agentDocuments.overwriteConfirm.title'),
    });
  };

  return (
    <Space direction={'vertical'} size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ marginBottom: 0, marginTop: 0 }}>
        {t('agentDocuments.title')}
      </Typography.Title>
      <Typography.Text type={'secondary'}>{t('agentDocuments.desc')}</Typography.Text>

      <Space wrap align={'center'}>
        <Select
          loading={isTemplatesLoading}
          options={templateOptions}
          style={{ minWidth: 240 }}
          value={templateId}
          onChange={setTemplateId}
        />
        <Button
          disabled={!agentId}
          loading={isInitializingTemplate}
          type={'primary'}
          onClick={confirmInitializeTemplate}
        >
          {t('agentDocuments.createWithTemplate')}
        </Button>
      </Space>

      <Table
        columns={columns}
        dataSource={documents}
        loading={isDocumentsLoading}
        locale={{ emptyText: t('agentDocuments.empty') }}
        pagination={false}
        rowKey={'id'}
      />
    </Space>
  );
});

export default AgentDocuments;
