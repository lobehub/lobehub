'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RunTaskParams, RunTaskState } from '../../../types';

const styles = stylex.create({ identifierChip: { flexShrink: 0, paddingBlock: "2px", paddingInline: "8px", borderRadius: "999px", fontFamily: cssVar.fontFamilyCode, fontSize: "12px", color: cssVar.colorTextSecondary, backgroundColor: cssVar.colorFillTertiary, backgroundImage: "none" }, promptChip: { overflow: "hidden", display: "inline-flex", flexShrink: 1, alignItems: "center", minWidth: "0", maxWidth: "240px", paddingBlock: "2px", paddingInline: "8px", borderRadius: "999px", fontSize: "12px", color: cssVar.colorText, textOverflow: "ellipsis", whiteSpace: "nowrap", backgroundColor: cssVar.colorFillTertiary, backgroundImage: "none" }, separator: { flexShrink: 0, color: cssVar.colorTextQuaternary } });

export const RunTaskInspector = memo<BuiltinInspectorProps<RunTaskParams, RunTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const params = args || partialArgs || ({} as Partial<RunTaskParams>);
    const identifier = pluginState?.identifier ?? params.identifier;
    const continueTopicId = params.continueTopicId;
    const prompt = params.prompt;

    return (
      <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
        <Icon icon={Play} size={12} style={{ color: cssVar.colorWarning }} />
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-task.apiName.runTask')}
        </span>
        {identifier && (
          <span className={stylex.props(styles.identifierChip).className} style={{ marginInlineStart: 4 }}>
            {identifier}
          </span>
        )}
        {continueTopicId && (
          <>
            <span {...stylex.props(styles.separator)}>·</span>
            <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
              {t('builtins.lobe-task.run.continueTopic')}
            </span>
          </>
        )}
        {prompt && (
          <>
            <span {...stylex.props(styles.separator)}>·</span>
            <span {...stylex.props(styles.promptChip)}>{prompt}</span>
          </>
        )}
      </div>
    );
  },
);

RunTaskInspector.displayName = 'RunTaskInspector';

export default RunTaskInspector;
