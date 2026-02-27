'use client';

import { AGENT_PROFILE_URL, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentEvalRunStatus, EvalRunInputConfig } from '@lobechat/types';
import { Accordion, AccordionItem, ActionIcon, Avatar, Flexbox } from '@lobehub/ui';
import { App, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { createStaticStyles } from 'antd-style';
import { SquareArrowOutUpRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { agentService } from '@/services/agent';
import { useEvalStore } from '@/store/eval';

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_TIMEOUT_MINUTES = 240;

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentSelect: css`
    .ant-select-content-value {
      height: 22px !important;
    }
  `,
  hint: css`
    display: inline-block;
    margin-block-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface AgentOption {
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  id: string;
  title?: string | null;
}

interface RunEditModalProps {
  onClose: () => void;
  open: boolean;
  run: {
    config?: { k?: number; maxSteps?: number; timeout?: number } | null;
    datasetId: string;
    id: string;
    name?: string | null;
    status: AgentEvalRunStatus;
    targetAgentId?: string | null;
  };
}

const RunEditModal = memo<RunEditModalProps>(({ open, onClose, run }) => {
  const { t } = useTranslation('eval');
  const { t: tChat } = useTranslation('chat');
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { benchmarkId } = useParams<{ benchmarkId: string }>();
  const updateRun = useEvalStore((s) => s.updateRun);
  const datasetList = useEvalStore((s) => s.datasetList);
  const [form] = Form.useForm();
  const kValue = Form.useWatch('k', form) ?? 1;
  const [loading, setLoading] = useState(false);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const canChangeConfig = run?.status === 'idle';
  const isFinished = run?.status === 'completed';

  const currentDataset = useMemo(
    () => datasetList.find((ds) => ds.id === run?.datasetId),
    [datasetList, run?.datasetId],
  );

  useEffect(() => {
    if (!open || !canChangeConfig) return;
    setLoadingAgents(true);
    agentService
      .queryAgents()
      .then((list) => setAgents(list as AgentOption[]))
      .finally(() => setLoadingAgents(false));
  }, [open, canChangeConfig]);

  useEffect(() => {
    if (open && run) {
      form.setFieldsValue({
        k: run.config?.k,
        maxSteps: run.config?.maxSteps,
        name: run.name,
        targetAgentId: run.targetAgentId,
        timeoutMinutes: run.config?.timeout ? run.config.timeout / 60_000 : undefined,
      });
    }
  }, [open, run]);

  const inboxAgent: AgentOption = useMemo(
    () => ({
      avatar: DEFAULT_INBOX_AVATAR,
      id: INBOX_SESSION_ID,
      title: tChat('inbox.title'),
    }),
    [tChat],
  );

  const allAgents = useMemo(() => [inboxAgent, ...agents], [inboxAgent, agents]);

  const agentOptions = useMemo(
    () =>
      allAgents.map((agent) => ({
        label: (
          <span style={{ alignItems: 'center', display: 'inline-flex', gap: 8 }}>
            <Avatar
              avatar={agent.avatar || undefined}
              background={agent.backgroundColor || undefined}
              size={20}
              title={agent.title || ''}
            />
            <span>{agent.title}</span>
          </span>
        ),
        searchLabel: agent.title || '',
        value: agent.id,
      })),
    [allAgents],
  );

  const handleOpenAgent = useCallback((agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(AGENT_PROFILE_URL(agentId), `agent_${agentId}`, 'noopener,noreferrer');
  }, []);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const config: EvalRunInputConfig = {};
      if (!isFinished) {
        if (values.maxSteps != null) config.maxSteps = values.maxSteps;
        if (values.timeoutMinutes != null) config.timeout = values.timeoutMinutes * 60_000;
        if (values.k != null) config.k = values.k;
      }

      await updateRun({
        config: Object.keys(config).length > 0 ? config : undefined,
        id: run.id,
        name: values.name,
        targetAgentId: canChangeConfig ? values.targetAgentId : undefined,
      });
      message.success(t('run.edit.success'));
      onClose();
    } catch {
      message.error(t('run.edit.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      destroyOnClose
      confirmLoading={loading}
      okText={t('benchmark.edit.confirm')}
      open={open}
      title={t('run.edit.title')}
      onCancel={handleClose}
      onOk={handleSubmit}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label={t('run.create.dataset')}>
          <Space>
            <span>{currentDataset?.name || run.datasetId}</span>
            {currentDataset?.testCaseCount !== undefined && (
              <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>
                {t('run.create.caseCount', { count: currentDataset.testCaseCount })}
              </span>
            )}
            {benchmarkId && (
              <ActionIcon
                icon={SquareArrowOutUpRight}
                size="small"
                title={t('dataset.detail.viewDetail')}
                onClick={() => navigate(`/eval/bench/${benchmarkId}/datasets/${run.datasetId}`)}
              />
            )}
          </Space>
        </Form.Item>

        <Form.Item label={t('run.create.name')} name="name">
          <Input placeholder={t('run.create.name.placeholder')} variant="filled" />
        </Form.Item>

        {canChangeConfig && (
          <Form.Item
            label={t('run.create.agent')}
            name="targetAgentId"
            rules={[{ message: t('run.create.agent.required'), required: true }]}
          >
            <Select
              allowClear
              showSearch
              className={styles.agentSelect}
              loading={loadingAgents}
              options={agentOptions}
              placeholder={t('run.create.agent.placeholder')}
              variant="filled"
              filterOption={(input, option) =>
                (option?.searchLabel as string)?.toLowerCase().includes(input.toLowerCase())
              }
              optionRender={(option) => (
                <span
                  style={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'space-between',
                  }}
                >
                  {option.label}
                  <ActionIcon
                    icon={SquareArrowOutUpRight}
                    size="small"
                    onClick={(e) => handleOpenAgent(option.value as string, e)}
                  />
                </span>
              )}
            />
          </Form.Item>
        )}

        <Accordion defaultExpandedKeys={[]}>
          <AccordionItem
            itemKey="advanced"
            paddingBlock={6}
            paddingInline={4}
            title={t('run.create.advanced')}
          >
            <Flexbox gap={16} style={{ paddingTop: 8 }}>
              <Form.Item
                extra={<span className={styles.hint}>{t('run.config.k.hint', { k: kValue })}</span>}
                label={t('run.config.k')}
                name="k"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  disabled={isFinished}
                  max={10}
                  min={1}
                  step={1}
                  style={{ width: '100%' }}
                  variant="filled"
                />
              </Form.Item>
              <Form.Item
                extra={<span className={styles.hint}>{t('run.config.maxSteps.hint')}</span>}
                label={t('run.config.maxSteps')}
                name="maxSteps"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  disabled={isFinished}
                  max={1000}
                  min={1}
                  step={10}
                  style={{ width: '100%' }}
                  variant="filled"
                />
              </Form.Item>
              <Form.Item
                label={t('run.config.timeout')}
                name="timeoutMinutes"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  disabled={isFinished}
                  max={MAX_TIMEOUT_MINUTES}
                  min={1}
                  style={{ width: '100%' }}
                  suffix={t('run.config.timeout.unit')}
                  variant="filled"
                />
              </Form.Item>
            </Flexbox>
          </AccordionItem>
        </Accordion>
      </Form>
    </Modal>
  );
});

export default RunEditModal;
