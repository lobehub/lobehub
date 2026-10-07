'use client';

import { AGENT_PROFILE_URL } from '@lobechat/const';
import type { AgentEvalRunDetail } from '@lobechat/types';
import { copyToClipboard, Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Avatar,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronLeft,
  Copy,
  Database,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { createRunEditModal } from '@/features/Eval/Benchmark/RunEditModal';
import { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import ModelLabel from '@/features/Eval/components/ModelLabel';
import StatusBadge from '@/features/Eval/StatusBadge';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { benchmarkSelectors, useEvalStore } from '@/store/eval';

import { createBatchResumeModal } from '../BatchResumeModal';
import ConfigSnapshot from './ConfigSnapshot';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;

    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  date: css`
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  link: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding: 0;
    border: none;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    background: transparent;

    &:hover {
      color: ${cssVar.colorPrimary};
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
}));

interface RunHeaderProps {
  benchmarkId: string;
  canBatchResume: boolean;
  /** Finished run with errored cases. */
  canRetryErrors: boolean;
  run: AgentEvalRunDetail;
}

const RunHeader = ({ run, benchmarkId, canBatchResume, canRetryErrors }: RunHeaderProps) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const benchmark = useEvalStore(benchmarkSelectors.getBenchmarkById(benchmarkId));
  const abortRun = useEvalStore((s) => s.abortRun);
  const deleteRun = useEvalStore((s) => s.deleteRun);
  const startRun = useEvalStore((s) => s.startRun);
  const retryRunErrors = useEvalStore((s) => s.retryRunErrors);
  const batchResumeRunCases = useEvalStore((s) => s.batchResumeRunCases);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const isActive = run.status === 'running' || run.status === 'pending';
  // Idle runs start from the progress panel, so the header never shows a second primary.
  const canRestart = run.status === 'failed' || run.status === 'aborted';

  const snapshot = run.config?.agentSnapshot;
  const model = run.config?.subjectModel || snapshot?.model || run.targetAgent?.model;
  const provider = run.config?.subjectModel
    ? run.config?.subjectProvider
    : snapshot?.provider || run.targetAgent?.provider;

  const handleStart = () =>
    confirmModal({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          setStarting(true);
          await startRun(run.id, true);
        } catch (error: any) {
          toast.error(error?.message || t('run.error.start'));
        } finally {
          setStarting(false);
        }
      },
      title: t('run.actions.start'),
    });

  const handleRetryErrors = () =>
    confirmModal({
      content: t('run.actions.retryErrors.confirm'),
      onOk: async () => {
        setRetrying(true);
        try {
          await retryRunErrors(run.id);
        } finally {
          setRetrying(false);
        }
      },
      title: t('run.actions.retryErrors'),
    });

  const handleAbort = () =>
    confirmModal({
      content: t('run.actions.abort.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.abort'),
      onOk: () => abortRun(run.id),
      title: t('run.actions.abort'),
    });

  const handleDelete = () =>
    confirmModal({
      content: t('run.actions.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.delete'),
      onOk: async () => {
        await deleteRun(run.id);
        navigate(`/eval/bench/${benchmarkId}`);
      },
      title: t('run.actions.delete'),
    });

  const handleCopyId = async () => {
    try {
      await copyToClipboard(run.id);
      toast.success(t('run.detail.copyRunIdSuccess'));
    } catch {
      toast.error(t('run.detail.copyRunIdFailed'));
    }
  };

  const menuItems: DropdownItem[] = [
    {
      icon: <Pencil size={14} />,
      key: 'edit',
      label: t('run.actions.edit'),
      onClick: () => createRunEditModal({ run }),
    },
    {
      icon: <Copy size={14} />,
      key: 'copy',
      label: t('run.detail.copyRunId'),
      onClick: handleCopyId,
    },
    { type: 'divider' },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('run.actions.delete'),
      onClick: handleDelete,
    },
  ];

  const openAgent = () => {
    if (!run.targetAgentId) return;
    window.open(
      buildWorkspaceAwarePath(AGENT_PROFILE_URL(run.targetAgentId), activeWorkspaceSlug),
      '_blank',
    );
  };

  const meta = [
    <StatusBadge key="status" status={run.status} />,
    model && (
      <span key="model" title={t('run.detail.subjectModel')}>
        <ModelLabel model={model} provider={provider} size={16} />
      </span>
    ),
    run.dataset && (
      <WorkspaceLink
        className={styles.link}
        key="dataset"
        to={`/eval/bench/${benchmarkId}/datasets/${run.dataset.id}`}
      >
        <Database size={14} />
        {run.dataset.name}
      </WorkspaceLink>
    ),
    run.targetAgentId && (
      <button className={styles.link} key="agent" type="button" onClick={openAgent}>
        <Avatar avatar={snapshot?.avatar || run.targetAgent?.avatar} size={16} />
        {run.targetAgent?.title || snapshot?.title || t('run.detail.agent.unnamed')}
      </button>
    ),
    run.createdAt && (
      <span className={styles.date} key="date">
        {new Date(run.createdAt).toLocaleString()}
      </span>
    ),
  ].filter(Boolean);

  return (
    <Flexbox gap={12}>
      <EvalPageHeader
        title={run.name || run.id}
        actions={
          <>
            {isActive && (
              <Button icon={<Square size={14} />} onClick={handleAbort}>
                {t('run.actions.abort')}
              </Button>
            )}
            {canBatchResume && (
              <Button
                icon={<Play size={14} />}
                onClick={() =>
                  createBatchResumeModal({
                    onConfirm: (targets) => batchResumeRunCases(run.id, targets),
                    runId: run.id,
                  })
                }
              >
                {t('run.actions.batchResume')}
              </Button>
            )}
            {canRetryErrors && (
              <Button
                icon={<RotateCcw size={14} />}
                loading={retrying}
                type={canRestart ? 'default' : 'primary'}
                onClick={handleRetryErrors}
              >
                {t('run.actions.retryErrors')}
              </Button>
            )}
            {canRestart && (
              <Button
                icon={<Play size={14} />}
                loading={starting}
                type="primary"
                onClick={handleStart}
              >
                {t('run.actions.start')}
              </Button>
            )}
            <DropdownMenu items={menuItems} placement="bottomRight">
              <ActionIcon icon={MoreHorizontal} title={t('run.actions.more')} />
            </DropdownMenu>
          </>
        }
        breadcrumb={
          <WorkspaceLink className={styles.crumb} to={`/eval/bench/${benchmarkId}`}>
            <ChevronLeft size={14} />
            {benchmark?.name || t('run.detail.backToBenchmark')}
          </WorkspaceLink>
        }
        meta={
          <Flexbox horizontal align="center" gap={16} wrap="wrap">
            {meta}
          </Flexbox>
        }
      />
      <ConfigSnapshot snapshot={snapshot} />
    </Flexbox>
  );
};

export default RunHeader;
