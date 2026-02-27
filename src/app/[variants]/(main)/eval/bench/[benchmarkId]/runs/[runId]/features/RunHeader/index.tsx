'use client';

import { AGENT_PROFILE_URL } from '@lobechat/const';
import type { AgentEvalRunDetail } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Highlighter, Markdown } from '@lobehub/ui';
import { App, Button, Card, Tag, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import RunEditModal from '@/app/[variants]/(main)/eval/bench/[benchmarkId]/features/RunEditModal';
import StatusBadge from '@/app/[variants]/(main)/eval/features/StatusBadge';
import { useEvalStore } from '@/store/eval';

const useStyles = createStyles(({ css, token }) => ({
  backLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: 14px;
    color: ${token.colorTextTertiary};
    text-decoration: none;

    transition: color 0.2s;

    &:hover {
      color: ${token.colorText};
    }
  `,
  configSection: css`
    margin-block-start: 12px;
  `,
  configSectionLabel: css`
    margin-block-end: 8px;
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
  `,
  systemRole: css`
    overflow: auto;

    max-height: 300px;
    padding: 12px;
    border-radius: 6px;

    font-size: 13px;

    background: ${token.colorFillQuaternary};
  `,
  configToggle: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    padding: 0;
    border: none;

    font-size: 12px;
    color: ${token.colorTextTertiary};

    background: transparent;

    transition: color 0.2s;

    &:hover {
      color: ${token.colorText};
    }
  `,
  datasetLink: css`
    color: inherit;
    text-decoration: none;

    &:hover {
      color: ${token.colorPrimary};
    }
  `,
  metaRow: css`
    flex-wrap: wrap;
    font-size: 13px;
    color: ${token.colorTextTertiary};
  `,
  modelText: css`
    font-family: monospace;
    font-size: 12px;
  `,
  separator: css`
    color: ${token.colorBorder};
  `,
  titleRow: css`
    margin-block-end: 16px;
  `,
}));

interface RunHeaderProps {
  benchmarkId: string;
  hideStart?: boolean;
  run: AgentEvalRunDetail;
}

const RunHeader = memo<RunHeaderProps>(({ run, benchmarkId, hideStart }) => {
  const { t } = useTranslation('eval');
  const { styles } = useStyles();
  const { modal, message } = App.useApp();
  const navigate = useNavigate();
  const abortRun = useEvalStore((s) => s.abortRun);
  const deleteRun = useEvalStore((s) => s.deleteRun);
  const startRun = useEvalStore((s) => s.startRun);
  const isActive = run.status === 'running' || run.status === 'pending';
  const canStart = run.status === 'idle' || run.status === 'failed' || run.status === 'aborted';
  const [starting, setStarting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const snapshot = run.config?.agentSnapshot;
  const agentTitle = run.targetAgent?.title || t('run.detail.agent.unnamed');
  const agentAvatar = snapshot?.avatar || run.targetAgent?.avatar;
  const agentModel = snapshot?.model || run.targetAgent?.model;
  const agentProvider = snapshot?.provider || run.targetAgent?.provider;

  const handleAbort = () => {
    modal.confirm({
      content: t('run.actions.abort.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.abort'),
      onOk: () => abortRun(run.id),
      title: t('run.actions.abort'),
    });
  };

  const handleDelete = () => {
    modal.confirm({
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
    modal.confirm({
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

  const formatDate = (date?: Date | string) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString();
  };

  return (
    <Flexbox gap={16}>
      {/* Back link */}
      <Link className={styles.backLink} to={`/eval/bench/${benchmarkId}`}>
        <ArrowLeft size={16} />
        {t('run.detail.backToBenchmark')}
      </Link>

      {/* Header Card */}
      <Card styles={{ body: { padding: 20 } }}>
        {/* Title row */}
        <Flexbox horizontal align="center" className={styles.titleRow} justify="space-between">
          <Flexbox gap={4}>
            <Flexbox horizontal align="center" gap={8}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {run.name || run.id.slice(0, 8)}
              </Typography.Title>
              <StatusBadge status={run.status} />
            </Flexbox>
            {/* Meta info row */}
            <Flexbox horizontal align="center" className={styles.metaRow} gap={8}>
              {run.dataset && (
                <Link
                  className={styles.datasetLink}
                  target="_blank"
                  to={`/eval/bench/${benchmarkId}/datasets/${run.dataset.id}`}
                >
                  {run.dataset.name}
                </Link>
              )}
              {run.targetAgentId && (
                <>
                  <span className={styles.separator}>|</span>
                  <Flexbox
                    horizontal
                    align="center"
                    gap={4}
                    style={{ cursor: 'pointer' }}
                    onClick={handleOpenAgent}
                  >
                    <Avatar avatar={agentAvatar} size={16} />
                    <span>{agentTitle}</span>
                  </Flexbox>
                </>
              )}
              {agentModel && (
                <>
                  <span className={styles.separator}>|</span>
                  <span className={styles.modelText}>
                    {agentProvider ? `${agentProvider} / ` : ''}
                    {agentModel}
                  </span>
                </>
              )}
              {run.createdAt && (
                <>
                  <span className={styles.separator}>|</span>
                  <span>{formatDate(run.createdAt)}</span>
                </>
              )}
            </Flexbox>
          </Flexbox>
          {/* Actions */}
          <Flexbox horizontal align="center" gap={8}>
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
              onClick={() => setEditOpen(true)}
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
      </Card>

      <RunEditModal open={editOpen} run={run} onClose={() => setEditOpen(false)} />
    </Flexbox>
  );
});

export default RunHeader;
