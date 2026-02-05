import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle, FileText } from 'lucide-react';
import { memo } from 'react';

import type { UpdatePromptParams, UpdatePromptState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    font-size: 13px;
  `,
  fileIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,
  promptCard: css`
    margin-inline-start: 12px;
    padding: 12px;
    border-inline-start: 3px solid ${cssVar.colorSuccess};
    background: ${cssVar.colorFillTertiary};
  `,
  promptContent: css`
    overflow: auto;

    max-height: 200px;
    margin-inline: -12px;
    margin-inline-start: 20px;
    padding-inline: 12px;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  promptLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  statusRow: css`
    margin-block-end: 6px;
    margin-inline-start: 9px;
    color: ${cssVar.colorSuccess};
  `,
  statusText: css`
    font-weight: 500;
  `,
}));

const UpdatePrompt = memo<BuiltinRenderProps<UpdatePromptParams, UpdatePromptState>>(
  ({ pluginState }) => {
    const { newPrompt } = pluginState || {};

    return (
      <Flexbox className={styles.container} gap={8}>
        <Flexbox horizontal align={'center'} className={styles.statusRow} gap={6}>
          <CheckCircle size={14} />
          <span className={styles.statusText}>
            {newPrompt ? 'System prompt updated' : 'System prompt cleared'}
          </span>
        </Flexbox>

        {newPrompt && (
          <Flexbox className={styles.promptCard} gap={8}>
            <Flexbox horizontal align={'center'} gap={6}>
              <FileText className={styles.fileIcon} size={14} />
              <span className={styles.promptLabel}>
                New prompt ({newPrompt.length} characters):
              </span>
            </Flexbox>
            <div className={styles.promptContent}>
              {newPrompt.length > 500 ? newPrompt.slice(0, 500) + '...' : newPrompt}
            </div>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default UpdatePrompt;
