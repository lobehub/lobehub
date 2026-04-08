import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, CircleX, Loader2, LucideBug, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import dynamic from '@/libs/next/dynamic';

import { useConversationStore } from '../../../store';
import { getToolDisplayName, getToolFirstDetail } from '../toolDisplayNames';
import WorkflowToolDetail from './WorkflowToolDetail';

const Debug = dynamic(() => import('../Tool/Debug'), { ssr: false });

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: none;
    gap: 2px;
    align-items: center;
    margin-inline-start: auto;
  `,
  detail: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;

    transition: background 0.1s;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover .workflow-tool-actions {
      display: flex;
    }
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 24px;
  `,
}));

const getToolColor = (apiName: string, hasError: boolean): string => {
  if (hasError) return cssVar.colorError;
  if (apiName.includes('search') || apiName.includes('crawl')) return '#c084fc';
  if (apiName.includes('exec') || apiName.includes('run') || apiName.includes('activate'))
    return cssVar.colorWarning;
  if (apiName.includes('write') || apiName.includes('create')) return cssVar.colorSuccess;
  return cssVar.colorInfo;
};

interface WorkflowToolLineProps {
  assistantMessageId: string;
  blockMessageId: string;
  disableEditing?: boolean;
  tool: ChatToolPayloadWithResult;
}

const WorkflowToolLine = memo<WorkflowToolLineProps>(
  ({ tool, assistantMessageId, blockMessageId, disableEditing }) => {
    const { t } = useTranslation('plugin');
    const removeToolFromMessage = useConversationStore((s) => s.removeToolFromMessage);
    const [showDebug, setShowDebug] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const displayName = getToolDisplayName(tool.apiName);
    const detail = getToolFirstDetail(tool);
    const hasError = !!tool.result?.error;
    const isAborted = tool.intervention?.status === 'aborted';
    const hasResult =
      tool.result != null && tool.result.content !== LOADING_FLAT && tool.result.content != null;
    const actionColor = getToolColor(tool.apiName, hasError);

    const isLoading = !hasResult && !hasError && !isAborted;

    const handleClick = () => {
      if (hasResult) setExpanded((prev) => !prev);
    };

    const statusIcon = hasError ? (
      <CircleX size={14} style={{ color: cssVar.colorError }} />
    ) : isLoading ? (
      <Loader2
        size={14}
        style={{
          animation: 'spin 1s linear infinite',
          color: cssVar.colorTextQuaternary,
        }}
      />
    ) : (
      <CheckCircle2 size={14} style={{ color: cssVar.colorSuccess }} />
    );

    return (
      <>
        <div className={styles.root} onClick={handleClick}>
          <span className={styles.statusIcon}>{statusIcon}</span>
          <span style={{ color: actionColor, flexShrink: 0 }}>{displayName}</span>
          {detail && (
            <>
              <span className={styles.separator}>·</span>
              <span className={styles.detail}>{detail}</span>
            </>
          )}
          {!disableEditing && (
            <div className={`workflow-tool-actions ${styles.actions}`}>
              <ActionIcon
                active={showDebug}
                icon={LucideBug}
                size={'small'}
                title={t(showDebug ? 'debug.off' : 'debug.on')}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDebug((v) => !v);
                }}
              />
              <ActionIcon
                danger
                icon={Trash2}
                size={'small'}
                title={t('inspector.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  removeToolFromMessage(blockMessageId, tool.id);
                }}
              />
            </div>
          )}
        </div>
        {showDebug && (
          <Debug
            apiName={tool.apiName}
            identifier={tool.identifier}
            intervention={tool.intervention}
            requestArgs={tool.arguments}
            result={tool.result}
            toolCallId={tool.id}
            type={tool.type}
          />
        )}
        {hasResult && <WorkflowToolDetail content={tool.result!.content!} open={expanded} />}
      </>
    );
  },
);

WorkflowToolLine.displayName = 'WorkflowToolLine';

export default WorkflowToolLine;
