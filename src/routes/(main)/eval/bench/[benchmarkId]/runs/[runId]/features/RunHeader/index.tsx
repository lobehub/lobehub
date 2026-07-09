'use client';

import { AGENT_PROFILE_URL } from '@lobechat/const';
import type { AgentEvalRunDetail } from '@lobechat/types';
import { ActionIcon, Avatar, copyToClipboard, Flexbox, Highlighter, Markdown } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { App, Tag } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { createRunEditModal } from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunEditModal';
import StatusBadge from '@/routes/(main)/eval/features/StatusBadge';
import { useEvalStore } from '@/store/eval';

const styles = createStaticStyles(({ css }) => ({
  backLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  configSection: css`
    margin-block-start: 12px;
  `,
  configSectionLabel: css`
    margin-block-end: 8px;
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  systemRole: css`
    overflow: auto;

    max-height: 300px;
    padding: 12px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: ${cssVar.fontSize};

    background: ${cssVar.colorFillQuaternary};
  `,
  configToggle: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    width: fit-content;
    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  agentLink: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadiusSM};
    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  datasetLink: css`
    color: inherit;
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  headerBand: css`
    padding: 20px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  metaItem: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  metaLabel: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  metaRow: css`
    flex-wrap: wrap;
  `,
  modelText: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  runName: css`
    margin: 0;

    font-size: ${cssVar.fontSizeHeading3};
    font-weight: 600;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
}));

interface RunHeaderProps {
  benchmarkId: string;
  hideStart?: boolean;
  run: AgentEvalRunDetail;
}

const RunHeader = memo<RunHeaderProps>(({ run, benchmarkId, hideStart }) => {
  const { t } = useTranslation('eval');
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const abortRun = useEvalStore((s) => s.abortRun);
  const deleteRun = useEvalStore((s) => s.deleteRun);
  const startRun = useEvalStore((s) => s.startRun);
  const isActive = run.status === 'running' || run.status === 'pending';
  const canStart = run.status === 'idle' || run.status === 'failed' || run.status === 'aborted';
  const [starting, setStarting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const snapshot = run.config?.agentSnapshot;
  const agentTitle = run.targetAgent?.title || t('run.detail.agent.unnamed');
  const agentAvatar = snapshot?.avatar || run.targetAgent?.avatar;
  const agentModel = snapshot?.model || run.targetAgent?.model;
  const agentProvider = snapshot?.provider || run.targetAgent?.provider;

  const handleAbort = () => {
    confirmModal({
      content: t('run.actions.abort.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.abort'),
      onOk: () => abortRun(run.id),
      title: t('run.actions.abort'),
    });
  };

  const handleDelete = () => {
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
  };

  const handleStart = () => {
    confirmModal({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          setStarting(true);
          await startRun(run.id, run.status !== 'idle');
        } catch (error: any) {
          message.error(error?.message || 'Failed to start run');
        } finally {
          setStarting(false);
        }
      },
      title: t('run.actions.start'),
    });
  };

  const handleOpenAgent = () => {
    if (run.targetAgentId) {
      window.open(AGENT_PROFILE_URL(run.targetAgentId), '_blank');
    }
  };
  const handleCopyRunId = async () => {
    try {
      await copyToClipboard(run.id);
      message.success(t('run.detail.copyRunIdSuccess'));
    } catch {
      message.error(t('run.detail.copyRunIdFailed'));
    }
  };

  const formatDate = (date?: Date | string) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString();
  };

  return (
    <Flexbox gap={16}>
      {/* Back link */}
      <WorkspaceLink className={styles.backLink} to={`/eval/bench/${benchmarkId}`}>
        <ArrowLeft size={16} />
        {t('run.detail.backToBenchmark')}
      </WorkspaceLink>

      {/* Header band — results-led: run name + status prominent, meta as a quiet stat row */}
      <Flexbox className={styles.headerBand} gap={16}>
        {/* Title row */}
        <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
          <Flexbox gap={10} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={12}>
              <h1 className={styles.runName}>{run.name || run.id.slice(0, 8)}</h1>
              <StatusBadge status={run.status} />
              <ActionIcon
                icon={Copy}
                size="small"
                title={t('run.detail.copyRunId')}
                onClick={handleCopyRunId}
              />
            </Flexbox>
            {/* Meta info — quiet stat chips */}
            <Flexbox horizontal align="center" className={styles.metaRow} gap={8}>
              {run.dataset && (
                <WorkspaceLink
                  className={styles.datasetLink}
                  target="_blank"
                  to={`/eval/bench/${benchmarkId}/datasets/${run.dataset.id}`}
                >
                  <span className={styles.metaItem}>{run.dataset.name}</span>
                </WorkspaceLink>
              )}
              {run.targetAgentId && (
                <Flexbox
                  horizontal
                  align="center"
                  className={styles.agentLink}
                  role={'button'}
                  tabIndex={0}
                  onClick={handleOpenAgent}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenAgent();
                    }
                  }}
                >
                  <span className={styles.metaItem}>
                    <Avatar avatar={agentAvatar} size={16} />
                    {agentTitle}
                  </span>
                </Flexbox>
              )}
              {agentModel && (
                <span className={styles.metaItem}>
                  <span className={styles.modelText}>
                    {agentProvider ? `${agentProvider} / ` : ''}
                    {agentModel}
                  </span>
                </span>
              )}
              {run.createdAt && (
                <span className={styles.metaItem}>
                  <span className={styles.metaLabel}>{formatDate(run.createdAt)}</span>
                </span>
              )}
            </Flexbox>
          </Flexbox>
          {/* Actions */}
          <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
            {canStart && !hideStart && (
              <Button
                icon={<Play size={14} />}
                loading={starting}
                type="primary"
                onClick={handleStart}
              >
                {t('run.actions.start')}
              </Button>
            )}
            <ActionIcon
              icon={Pencil}
              size="small"
              title={t('run.actions.edit')}
              onClick={() => createRunEditModal({ run })}
            />
            {isActive && (
              <ActionIcon
                icon={Square}
                size="small"
                title={t('run.actions.abort')}
                onClick={handleAbort}
              />
            )}
            <ActionIcon
              icon={Trash2}
              size="small"
              title={t('run.actions.delete')}
              onClick={handleDelete}
            />
          </Flexbox>
        </Flexbox>

        {/* Collapsible config */}
        <button className={styles.configToggle} onClick={() => setShowConfig(!showConfig)}>
          {showConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {t('run.detail.configSnapshot')}
        </button>
        {showConfig && snapshot && (
          <Flexbox gap={0}>
            {/* System Role */}
            {snapshot.systemRole && (
              <div className={styles.configSection}>
                <div className={styles.configSectionLabel}>System Role</div>
                <div className={styles.systemRole}>
                  <Markdown variant="chat">{snapshot.systemRole}</Markdown>
                </div>
              </div>
            )}
            {/* Plugins */}
            {snapshot.plugins && snapshot.plugins.length > 0 && (
              <div className={styles.configSection}>
                <div className={styles.configSectionLabel}>Plugins</div>
                <Flexbox horizontal gap={4} wrap="wrap">
                  {snapshot.plugins.map((plugin) => (
                    <Tag key={plugin}>{plugin}</Tag>
                  ))}
                </Flexbox>
              </div>
            )}
            {/* chatConfig & params */}
            {(snapshot.chatConfig || snapshot.params) && (
              <div className={styles.configSection}>
                <Flexbox horizontal gap={12}>
                  {snapshot.chatConfig && (
                    <Flexbox flex={1} gap={0} style={{ minWidth: 0 }}>
                      <div className={styles.configSectionLabel}>Chat Config</div>
                      <Highlighter
                        language="json"
                        style={{ fontSize: 12, maxHeight: 300, overflow: 'auto' }}
                        variant="filled"
                      >
                        {JSON.stringify(snapshot.chatConfig, null, 2)}
                      </Highlighter>
                    </Flexbox>
                  )}
                  {snapshot.params && (
                    <Flexbox flex={1} gap={0} style={{ minWidth: 0 }}>
                      <div className={styles.configSectionLabel}>Params</div>
                      <Highlighter
                        language="json"
                        style={{ fontSize: 12, maxHeight: 300, overflow: 'auto' }}
                        variant="filled"
                      >
                        {JSON.stringify(snapshot.params, null, 2)}
                      </Highlighter>
                    </Flexbox>
                  )}
                </Flexbox>
              </div>
            )}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default RunHeader;
