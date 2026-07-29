'use client';

import { AGENT_PROFILE_URL, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentEvalRunStatus, EvalRunInputConfig } from '@lobechat/types';
import { Accordion, AccordionItem, ActionIcon, Avatar, Flexbox } from '@lobehub/ui';
import { Select, useModalContext } from '@lobehub/ui/base-ui';
import { App, Form, Input, InputNumber, Space } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { SquareArrowOutUpRight } from 'lucide-react';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { agentService } from '@/services/agent';
import { useEvalStore } from '@/store/eval';

const MAX_TIMEOUT_MINUTES = 240;

const styles = createStaticStyles(({ css }) => ({
  agentSelect: css`
    .ant-select-content-value {
      height: 22px !important;
    }
  `,
  hint: css`
    display: inline-block;
    margin-block-start: 4px;
    font-size: ${cssVar.fontSizeSM};
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

export interface RunEditContentProps {
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
  run: {
    config?: { k?: number; maxSteps?: number; timeout?: number } | null;
    datasetId: string;
    id: string;
    name?: string | null;
    status: AgentEvalRunStatus;
    targetAgentId?: string | null;
  };
}

const RunEditContent: FC<RunEditContentProps> = ({ formId, onLoadingChange, run }) => {
  const { t } = useTranslation('eval');
  const { t: tChat } = useTranslation('chat');
  const { close } = useModalContext();
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { benchmarkId } = useParams<{ benchmarkId: string }>();
  const updateRun = useEvalStore((s) => s.updateRun);
  const datasetList = useEvalStore((s) => s.datasetList);
  const [form] = Form.useForm();
  const kValue = Form.useWatch('k', form) ?? 1;

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const canChangeConfig = run?.status === 'idle';
  const isFinished = run?.status === 'completed';

  const currentDataset = useMemo(
    () => datasetList.find((ds) => ds.id === run?.datasetId),
    [datasetList, run?.datasetId],
  );

  useEffect(() => {
    if (!canChangeConfig) return;
    setLoadingAgents(true);
    agentService
      .queryAgents()
      .then((list) => setAgents(list as AgentOption[]))
      .finally(() => setLoadingAgents(false));
  }, [canChangeConfig]);

  useEffect(() => {
    if (run) {
      form.setFieldsValue({
        k: run.config?.k,
        maxSteps: run.config?.maxSteps,
        name: run.name,
        targetAgentId: run.targetAgentId,
        timeoutMinutes: run.config?.timeout ? run.config.timeout / 60_000 : undefined,
      });
    }
  }, [run, form]);

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
        title: agent.title || '',
        value: agent.id,
      })),
    [allAgents],
  );

  const handleOpenAgent = useCallback(
    (agentId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.open(
        buildWorkspaceAwarePath(AGENT_PROFILE_URL(agentId), activeWorkspaceSlug),
        `agent_${agentId}`,
        'noopener,noreferrer',
      );
    },
    [activeWorkspaceSlug],
  );

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
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
      close();
    } catch {
      message.error(t('run.edit.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  return (
    <Form form={form} layout="vertical" name={formId} onFinish={handleFinish}>
      <Form.Item label={t('run.create.dataset')}>
        <Space>
          <span>{currentDataset?.name || run.datasetId}</span>
          {currentDataset?.testCaseCount !== undefined && (
            <span style={{ color: cssVar.colorTextQuaternary, fontSize: 12 }}>
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
          paddingBlock={8}
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
  );
};

export default RunEditContent;
