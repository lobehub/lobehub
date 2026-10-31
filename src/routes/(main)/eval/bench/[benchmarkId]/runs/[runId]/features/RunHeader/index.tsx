'use client';

import { AGENT_PROFILE_URL } from '@lobechat/const';
import type { AgentEvalRunDetail } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  confirmModal,
  copyToClipboard,
  Flexbox,
  Highlighter,
  Markdown,
  Tag,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AgentAvatar from '@/components/AgentAvatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { createRunEditModal } from '@/routes/(main)/eval/bench/[benchmarkId]/features/RunEditModal';
import StatusBadge from '@/routes/(main)/eval/features/StatusBadge';
import { useEvalStore } from '@/store/eval';

const styles = stylex.create({
  backLink: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    width: 'fit-content',
    fontSize: cssVar.fontSize,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    textDecoration: 'none',
    transition: {
      'default': 'color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-1px' },
  },
  configSection: { marginBlockStart: '12px' },
  configSectionLabel: {
    marginBlockEnd: '8px',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  systemRole: {
    overflow: 'auto',
    maxHeight: '300px',
    padding: '12px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: cssVar.fontSize,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  configToggle: {
    cursor: 'pointer',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    width: 'fit-content',
    padding: '0',
    borderStyle: 'none',
    fontSize: cssVar.fontSizeSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: {
      'default': 'color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  agentLink: {
    cursor: 'pointer',
    borderRadius: cssVar.borderRadiusSM,
    transition: {
      'default': 'color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    color: { 'default': null, ':hover': cssVar.colorText },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  datasetLink: {
    color: { 'default': 'inherit', ':hover': cssVar.colorPrimary },
    textDecoration: 'none',
  },
  headerBand: {
    padding: '20px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  metaItem: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '4px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: cssVar.fontSize,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  metaLabel: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextTertiary },
  metaRow: { flexWrap: 'wrap' },
  modelText: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
  },
  runName: {
    margin: '0',
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    lineHeight: 1.2,
    color: cssVar.colorText,
  },
});

interface RunHeaderProps {
  benchmarkId: string;
  hideStart?: boolean;
  run: AgentEvalRunDetail;
}

const RunHeader = memo<RunHeaderProps>(({ run, benchmarkId, hideStart }) => {
  const { t } = useTranslation('eval');

  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
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
          toast.error(error?.message || 'Failed to start run');
        } finally {
          setStarting(false);
        }
      },
      title: t('run.actions.start'),
    });
  };

  const handleOpenAgent = () => {
    if (run.targetAgentId) {
      window.open(
        buildWorkspaceAwarePath(AGENT_PROFILE_URL(run.targetAgentId), activeWorkspaceSlug),
        '_blank',
      );
    }
  };
  const handleCopyRunId = async () => {
    try {
      await copyToClipboard(run.id);
      toast.success(t('run.detail.copyRunIdSuccess'));
    } catch {
      toast.error(t('run.detail.copyRunIdFailed'));
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
      <WorkspaceLink
        className={stylex.props(styles.backLink).className}
        to={`/eval/bench/${benchmarkId}`}
      >
        <ArrowLeft size={16} />
        {t('run.detail.backToBenchmark')}
      </WorkspaceLink>

      {/* Header band — results-led: run name + status prominent, meta as a quiet stat row */}
      <Flexbox className={stylex.props(styles.headerBand).className} gap={16}>
        {/* Title row */}
        <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
          <Flexbox gap={10} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={12}>
              <h1 {...stylex.props(styles.runName)}>{run.name || run.id.slice(0, 8)}</h1>
              <StatusBadge status={run.status} />
              <ActionIcon
                icon={Copy}
                size="small"
                title={t('run.detail.copyRunId')}
                onClick={handleCopyRunId}
              />
            </Flexbox>
            {/* Meta info — quiet stat chips */}
            <Flexbox
              horizontal
              align="center"
              className={stylex.props(styles.metaRow).className}
              gap={8}
            >
              {run.dataset && (
                <WorkspaceLink
                  className={stylex.props(styles.datasetLink).className}
                  target="_blank"
                  to={`/eval/bench/${benchmarkId}/datasets/${run.dataset.id}`}
                >
                  <span {...stylex.props(styles.metaItem)}>{run.dataset.name}</span>
                </WorkspaceLink>
              )}
              {run.targetAgentId && (
                <Flexbox
                  horizontal
                  align="center"
                  className={stylex.props(styles.agentLink).className}
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
                  <span className={stylex.props(styles.metaItem).className}>
                    <AgentAvatar
                      agentId={run.targetAgentId}
                      avatar={agentAvatar}
                      name={agentTitle}
                      shape={'circle'}
                      size={16}
                    />
                    {agentTitle}
                  </span>
                </Flexbox>
              )}
              {agentModel && (
                <span {...stylex.props(styles.metaItem)}>
                  <span {...stylex.props(styles.modelText)}>
                    {agentProvider ? `${agentProvider} / ` : ''}
                    {agentModel}
                  </span>
                </span>
              )}
              {run.createdAt && (
                <span {...stylex.props(styles.metaItem)}>
                  <span {...stylex.props(styles.metaLabel)}>{formatDate(run.createdAt)}</span>
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
        <button {...stylex.props(styles.configToggle)} onClick={() => setShowConfig(!showConfig)}>
          {showConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {t('run.detail.configSnapshot')}
        </button>
        {showConfig && snapshot && (
          <Flexbox gap={0}>
            {/* System Role */}
            {snapshot.systemRole && (
              <div {...stylex.props(styles.configSection)}>
                <div {...stylex.props(styles.configSectionLabel)}>System Role</div>
                <div {...stylex.props(styles.systemRole)}>
                  <Markdown variant="chat">{snapshot.systemRole}</Markdown>
                </div>
              </div>
            )}
            {/* Plugins */}
            {snapshot.plugins && snapshot.plugins.length > 0 && (
              <div {...stylex.props(styles.configSection)}>
                <div {...stylex.props(styles.configSectionLabel)}>Plugins</div>
                <Flexbox horizontal gap={4} wrap="wrap">
                  {snapshot.plugins.map((plugin) => (
                    <Tag key={plugin}>{plugin}</Tag>
                  ))}
                </Flexbox>
              </div>
            )}
            {/* chatConfig & params */}
            {(snapshot.chatConfig || snapshot.params) && (
              <div {...stylex.props(styles.configSection)}>
                <Flexbox horizontal gap={12}>
                  {snapshot.chatConfig && (
                    <Flexbox flex={1} gap={0} style={{ minWidth: 0 }}>
                      <div {...stylex.props(styles.configSectionLabel)}>Chat Config</div>
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
                      <div {...stylex.props(styles.configSectionLabel)}>Params</div>
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
