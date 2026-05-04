'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RunTaskParams, RunTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifierChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  promptChip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 240px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export const RunTaskInspector = memo<BuiltinInspectorProps<RunTaskParams, RunTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const params = args || partialArgs || ({} as Partial<RunTaskParams>);
    const identifier = params.identifier;
    const continueTopicId = params.continueTopicId;
    const prompt = params.prompt;

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 4 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <Icon icon={Play} size={12} style={{ color: cssVar.colorWarning }} />
        <span>{t('builtins.lobe-task.apiName.runTask')}</span>
        {identifier && (
          <span className={styles.identifierChip} style={{ marginInlineStart: 4 }}>
            {identifier}
          </span>
        )}
        {continueTopicId && (
          <>
            <span className={styles.separator}>·</span>
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
              {t('builtins.lobe-task.run.continueTopic')}
            </span>
          </>
        )}
        {prompt && (
          <>
            <span className={styles.separator}>·</span>
            <span className={styles.promptChip}>{prompt}</span>
          </>
        )}
      </div>
    );
  },
);

RunTaskInspector.displayName = 'RunTaskInspector';

export default RunTaskInspector;
