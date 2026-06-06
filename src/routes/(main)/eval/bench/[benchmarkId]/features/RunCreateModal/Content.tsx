'use client';

import { AGENT_PROFILE_URL, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { Accordion, AccordionItem, ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Select, Space } from 'antd';
import { createStaticStyles } from 'antd-style';
import { SquareArrowOutUpRight } from 'lucide-react';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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
  timestampLink: css`
    cursor: pointer;

    display: inline-block;

    margin-block-start: 4px;

    font-size: 12px;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

interface AgentOption {
  avatar?: string | null;
  backgroundColor?: string | null;
  description?: string | null;
  id: string;
  title?: string | null;
}

export interface RunCreateContentProps {
  benchmarkId: string;
  datasetId?: string;
  datasetName?: string;
  onLoadingChange?: (loading: boolean) => void;
  onSubmitReady: (submit: (shouldStart: boolean) => Promise<void>) => void;
}

const RunCreateContent: FC<RunCreateContentProps> = ({
  benchmarkId,
  datasetId,
  datasetName,
  onLoadingChange,
  onSubmitReady,
}) => {
  const { t } = useTranslation('eval');
  const { t: tChat } = useTranslation('chat');
  const { close } = useModalContext();
  const navigate = useNavigate();
  const createRun = useEvalStore((s) => s.createRun);
  const startRun = useEvalStore((s) => s.startRun);
  const datasetList = useEvalStore((s) => s.datasetList);
  const [form] = Form.useForm();
  const kValue = Form.useWatch('k', form) ?? 1;

  const isDatasetMode = !!datasetId && !!datasetName;

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    setLoadingAgents(true);
    agentService
      .queryAgents()
      .then((list) => setAgents(list as AgentOption[]))
      .finally(() => setLoadingAgents(false));
  }, []);

  useEffect(() => {
    if (datasetId && !isDatasetMode) {
      form.setFieldsValue({ datasetId });
    }
  }, [datasetId, isDatasetMode, form]);

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

  const submit = useCallback(
    async (shouldStart: boolean) => {
      let values;
      try {
        values = await form.validateFields();
      } catch {
        return;
      }
      onLoadingChange?.(true);
      try {
        const maxSteps = values.maxSteps ?? DEFAULT_MAX_STEPS;
        const timeoutMinutes = values.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
        const k = values.k ?? 1;
        const run = await createRun({
          config: {
            k,
            maxSteps,
            timeout: timeoutMinutes * 60_000,
          },
          datasetId: isDatasetMode ? datasetId : values.datasetId,
          name: values.name,
          targetAgentId: values.targetAgentId,
        });
        if (run?.id) {
          if (shouldStart) {
            await startRun(run.id);
          }
          navigate(`/eval/bench/${benchmarkId}/runs/${run.id}`);
        }
        close();
      } finally {
        onLoadingChange?.(false);
      }
    },
    [
      benchmarkId,
      close,
      createRun,
      datasetId,
      form,
      isDatasetMode,
      navigate,
      onLoadingChange,
      startRun,
    ],
  );

  useEffect(() => {
    onSubmitReady(submit);
  }, [onSubmitReady, submit]);

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        label={t('run.create.name')}
        name="name"
        rules={[{ message: t('run.create.name.required'), required: true }]}
        extra={
          <Text
            className={styles.timestampLink}
            type="secondary"
            onClick={() => {
              const now = new Date();
              const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
              form.setFieldsValue({ name: ts });
            }}
          >
            {t('run.create.name.useTimestamp')}
          </Text>
        }
      >
        <Input placeholder={t('run.create.name.placeholder')} variant="filled" />
      </Form.Item>

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

      {!isDatasetMode && (
        <Form.Item
          label={t('run.create.dataset')}
          name="datasetId"
          rules={[{ message: t('run.create.dataset.required'), required: true }]}
        >
          <Select
            placeholder={t('run.create.dataset.placeholder')}
            variant="filled"
            options={datasetList.map((ds) => ({
              label: (
                <Space>
                  <span>{ds.name}</span>
                  {ds.testCaseCount !== undefined && (
                    <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>
                      {t('run.create.caseCount', { count: ds.testCaseCount })}
                    </span>
                  )}
                </Space>
              ),
              value: ds.id,
            }))}
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
              initialValue={1}
              label={t('run.config.k')}
              name="k"
              style={{ marginBottom: 0 }}
            >
              <InputNumber max={10} min={1} step={1} style={{ width: '100%' }} variant="filled" />
            </Form.Item>
            <Form.Item
              extra={<span className={styles.hint}>{t('run.config.maxSteps.hint')}</span>}
              initialValue={DEFAULT_MAX_STEPS}
              label={t('run.config.maxSteps')}
              name="maxSteps"
              style={{ marginBottom: 0 }}
            >
              <InputNumber
                max={1000}
                min={1}
                step={10}
                style={{ width: '100%' }}
                variant="filled"
              />
            </Form.Item>
            <Form.Item
              initialValue={DEFAULT_TIMEOUT_MINUTES}
              label={t('run.config.timeout')}
              name="timeoutMinutes"
              style={{ marginBottom: 0 }}
            >
              <InputNumber
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

export default RunCreateContent;
