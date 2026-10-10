'use client';

import { AGENT_PROFILE_URL, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import {
  Accordion,
  ActionIcon,
  Avatar,
  createStaticStyles,
  cssVar,
  Flexbox,
  Input,
  InputNumber,
  Select,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Form, useForm, useWatch } from '@lobehub/ui/form';
import { SquareArrowOutUpRight } from 'lucide-react';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { agentService } from '@/services/agent';
import { useEvalStore } from '@/store/eval';

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_TIMEOUT_MINUTES = 30;
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
  timestampLink: css`
    cursor: pointer;

    display: inline-block;

    margin-block-start: 4px;

    font-size: ${cssVar.fontSizeSM};

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

interface RunCreateFormValues {
  datasetId?: string;
  k?: number | null;
  maxSteps?: number | null;
  name?: string;
  targetAgentId?: string;
  timeoutMinutes?: number | null;
}

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
  /** When set, the created run is tagged to this experiment (and the
   * experiment detail payload is revalidated instead of the benchmark runs). */
  experimentId?: string;
  onLoadingChange?: (loading: boolean) => void;
  onSubmitReady: (submit: (shouldStart: boolean) => Promise<void>) => void;
}

const RunCreateContent: FC<RunCreateContentProps> = ({
  benchmarkId,
  datasetId,
  datasetName,
  experimentId,
  onLoadingChange,
  onSubmitReady,
}) => {
  const { t } = useTranslation('eval');
  const { t: tChat } = useTranslation('chat');

  const { close } = useModalContext();
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const createRun = useEvalStore((s) => s.createRun);
  const startRun = useEvalStore((s) => s.startRun);
  const datasetList = useEvalStore((s) => s.datasetList);
  const isDatasetMode = !!datasetId && !!datasetName;
  const form = useForm<RunCreateFormValues>({
    initialValues: {
      datasetId: datasetId && !isDatasetMode ? datasetId : undefined,
      k: 1,
      maxSteps: DEFAULT_MAX_STEPS,
      timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
    },
  });
  const kValue = useWatch(form, 'k') ?? 1;

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    setLoadingAgents(true);
    agentService
      // The inbox is added locally as `inboxAgent` just below; asking the query
      // for it as well would offer Lobe AI twice under two different ids.
      .queryAgents({ includeInbox: false })
      .then((list) => setAgents(list as AgentOption[]))
      .finally(() => setLoadingAgents(false));
  }, []);

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

  const submit = useCallback(
    async (shouldStart: boolean) => {
      const { valid } = await form.validate();
      if (!valid) return;
      const values = form.getValues();
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
          datasetId: (isDatasetMode ? datasetId : values.datasetId)!,
          experimentId,
          name: values.name,
          targetAgentId: values.targetAgentId,
        });
        if (run?.id) {
          try {
            if (shouldStart) {
              await startRun(run.id);
            }
          } catch {
            // Run was created — surface the start failure (ux Act) but keep
            // going to the run page so the user can retry there.
            toast.error(t('run.error.start'));
          }
          navigate(`/eval/bench/${benchmarkId}/runs/${run.id}`);
        }
        close();
      } catch (error) {
        // createRun failure: toast and keep the modal open for retry (ux Act).
        toast.error(
          error instanceof Error && error.message ? error.message : t('run.create.error'),
        );
      } finally {
        onLoadingChange?.(false);
      }
    },
    [
      benchmarkId,
      close,
      createRun,
      datasetId,
      experimentId,
      form,
      isDatasetMode,
      navigate,
      onLoadingChange,
      startRun,
      t,
    ],
  );

  useEffect(() => {
    onSubmitReady(submit);
  }, [onSubmitReady, submit]);

  return (
    <Form form={form} layout="vertical">
      <Form.Field
        label={t('run.create.name')}
        name="name"
        required={t('run.create.name.required')}
        extra={
          <Text
            className={styles.timestampLink}
            type="secondary"
            onClick={() => {
              const now = new Date();
              const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
              form.setValue('name', ts);
            }}
          >
            {t('run.create.name.useTimestamp')}
          </Text>
        }
      >
        <Input placeholder={t('run.create.name.placeholder')} variant="filled" />
      </Form.Field>

      <Form.Field
        label={t('run.create.agent')}
        name="targetAgentId"
        required={t('run.create.agent.required')}
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
      </Form.Field>

      {!isDatasetMode && (
        <Form.Field
          label={t('run.create.dataset')}
          name="datasetId"
          required={t('run.create.dataset.required')}
        >
          <Select
            placeholder={t('run.create.dataset.placeholder')}
            variant="filled"
            options={datasetList.map((ds) => ({
              label: (
                <Flexbox horizontal align={'center'} gap={8}>
                  <span>{ds.name}</span>
                  {ds.testCaseCount !== undefined && (
                    <span style={{ color: cssVar.colorTextQuaternary, fontSize: 12 }}>
                      {t('run.create.caseCount', { count: ds.testCaseCount })}
                    </span>
                  )}
                </Flexbox>
              ),
              value: ds.id,
            }))}
          />
        </Form.Field>
      )}

      <Accordion
        keepMounted
        defaultValue={[]}
        indicatorPlacement="inline"
        styles={{ header: { paddingBlock: 8, paddingInline: 4 } }}
        items={[
          {
            children: (
              <Flexbox gap={16} style={{ paddingTop: 8 }}>
                <Form.Field
                  label={t('run.config.k')}
                  name="k"
                  style={{ paddingBlock: 0 }}
                  extra={
                    <span className={styles.hint}>{t('run.config.k.hint', { k: kValue })}</span>
                  }
                >
                  <InputNumber
                    max={10}
                    min={1}
                    step={1}
                    style={{ width: '100%' }}
                    variant="filled"
                  />
                </Form.Field>
                <Form.Field
                  extra={<span className={styles.hint}>{t('run.config.maxSteps.hint')}</span>}
                  label={t('run.config.maxSteps')}
                  name="maxSteps"
                  style={{ paddingBlock: 0 }}
                >
                  <InputNumber
                    max={1000}
                    min={1}
                    step={10}
                    style={{ width: '100%' }}
                    variant="filled"
                  />
                </Form.Field>
                <Form.Field
                  label={t('run.config.timeout')}
                  name="timeoutMinutes"
                  style={{ paddingBlock: 0 }}
                >
                  <InputNumber
                    max={MAX_TIMEOUT_MINUTES}
                    min={1}
                    style={{ width: '100%' }}
                    suffix={t('run.config.timeout.unit')}
                    variant="filled"
                  />
                </Form.Field>
              </Flexbox>
            ),
            key: 'advanced',
            title: t('run.create.advanced'),
          },
        ]}
      />
    </Form>
  );
};

export default RunCreateContent;
