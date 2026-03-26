import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown, ChevronRight, LucideBug, Rows3, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../store';
import { getToolDisplayName, getToolFirstDetail } from '../toolDisplayNames';
import WorkflowToolDetail from './WorkflowToolDetail';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 4px;
    transform: translateY(-50%);

    display: none;
    gap: 2px;
    align-items: center;

    padding-block: 0;
    padding-inline: 4px;

    background: inherit;
  `,
  chevron: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 10px;

    font-size: 9px;
    color: ${cssVar.colorTextQuaternary};
  `,
  detail: css`
    overflow: hidden;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  failedSuffix: css`
    flex-shrink: 0;
    margin-inline-start: auto;
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  root: css`
    cursor: pointer;

    position: relative;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 22px 8px;
    border-radius: 4px;

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
    color: ${cssVar.colorBorderSecondary};
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
  disableEditing?: boolean;
  tool: ChatToolPayloadWithResult;
}

const WorkflowToolLine = memo<WorkflowToolLineProps>(
  ({ tool, assistantMessageId, disableEditing }) => {
    const { t } = useTranslation('plugin');
    const deleteAssistantMessage = useConversationStore((s) => s.deleteAssistantMessage);
    const [showDebug, setShowDebug] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const displayName = getToolDisplayName(tool.apiName);
    const detail = getToolFirstDetail(tool);
    const hasError = !!tool.result?.error;
    const isAborted = tool.intervention?.status === 'aborted';
    const hasResult =
      tool.result != null && tool.result.content !== LOADING_FLAT && tool.result.content != null;
    const actionColor = getToolColor(tool.apiName, hasError);

    const statusSuffix = hasError ? 'failed' : isAborted ? 'aborted' : '';

    const handleClick = () => {
      if (hasResult) setExpanded((prev) => !prev);
    };

    return (
      <>
        <div className={styles.root} onClick={handleClick}>
          <span className={styles.chevron}>
            {hasResult ? expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} /> : null}
          </span>
          <span style={{ color: actionColor, flexShrink: 0 }}>{displayName}</span>
          {detail && (
            <>
              <span className={styles.separator}>—</span>
              <span className={styles.detail}>{detail}</span>
            </>
          )}
          {statusSuffix && <span className={styles.failedSuffix}>{statusSuffix}</span>}

          {!disableEditing && (
            <div className={`workflow-tool-actions ${styles.actions}`}>
              <ActionIcon
                active={showDebug}
                icon={LucideBug}
                size={'small'}
                title={t(showDebug ? 'debug.off' : 'debug.on')}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDebug(!showDebug);
                }}
              />
              <ActionIcon
                icon={Rows3}
                size={'small'}
                title={t('inspector.args')}
                onClick={(e) => e.stopPropagation()}
              />
              <ActionIcon
                danger
                icon={Trash2}
                size={'small'}
                title={t('inspector.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteAssistantMessage(assistantMessageId);
                }}
              />
            </div>
          )}
        </div>
        {hasResult && <WorkflowToolDetail content={tool.result!.content!} open={expanded} />}
      </>
    );
  },
);

WorkflowToolLine.displayName = 'WorkflowToolLine';

export default WorkflowToolLine;
