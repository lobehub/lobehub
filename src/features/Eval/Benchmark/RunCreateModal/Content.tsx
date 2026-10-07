'use client';

import { AGENT_PROFILE_URL, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import {
  Accordion,
  ActionIcon,
  Avatar,
  Input,
  InputNumber,
  Select,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { Form, useForm, useWatch } from '@lobehub/ui/base-ui/form';
import { createStaticStyles, cssVar } from 'antd-style';
import { SquareArrowOutUpRight } from 'lucide-react';
import pMap from 'p-map';
import { type FC, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import ModelMultiSelect, { fromTargetKey } from '@/features/Eval/components/ModelMultiSelect';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useEvalStore } from '@/store/eval';

import { type AgentOption, useAgentOptions } from '../../hooks/useAgentOptions';

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
  /** `provider/model` keys the agent is evaluated on; empty runs its own model. */
  subjects?: string[];
  targetAgentId?: string;
  timeoutMinutes?: number | null;
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
  const createSubjectRuns = useEvalStore((s) => s.createSubjectRuns);
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
  const subjectCount = useWatch(form, 'subjects')?.length ?? 0;

  const { agents, loadingAgents } = useAgentOptions();

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
        const config = { k, maxSteps, timeout: timeoutMinutes * 60_000 };
        const subjects = (values.subjects ?? []).map(fromTargetKey);
        const runDatasetId = (isDatasetMode ? datasetId : values.datasetId)!;

        // Several models: one run each for the same agent — comparing models
        // never needs a cloned agent. Land on the runs list, where they sit
        // side by side.
        if (subjects.length > 1) {
          const runs = await createSubjectRuns({
            config,
            datasetId: runDatasetId,
            experimentId,
            name: values.name,
            subjects,
            targetAgentId: values.targetAgentId!,
          });
          if (shouldStart) {
            const started = await pMap(
              runs,
              (r) =>
                startRun(r.id).then(
                  () => true,
                  () => false,
                ),
              { concurrency: 2 },
            );
            if (started.includes(false)) toast.error(t('run.error.start'));
          }
          navigate(
            experimentId ? `/eval/experiments/${experimentId}` : `/eval/bench/${benchmarkId}`,
          );
          close();
          return;
        }

        const run = await createRun({
          config: subjects[0]
            ? { ...config, subjectModel: subjects[0].model, subjectProvider: subjects[0].provider }
            : config,
          datasetId: runDatasetId,
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
      createSubjectRuns,
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

      <Form.Field
        label={t('run.create.subjects')}
        name="subjects"
        extra={
          <span className={styles.hint}>
            {subjectCount > 1
              ? t('run.create.subjects.hintMany', { count: subjectCount })
              : t('run.create.subjects.hint')}
          </span>
        }
      >
        <ModelMultiSelect placeholder={t('run.create.subjects.placeholder')} />
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
