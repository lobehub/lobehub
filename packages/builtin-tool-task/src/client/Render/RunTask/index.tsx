'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Play } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveTaskOpenTarget } from '../../../taskRef';
import type { RunTaskParams, RunTaskState } from '../../../types';
import { InlineField, monoChipClassName, SectionField, TaskResultCard } from '../shared';

const styles = stylex.create({
  topicChip: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorInfo,
    backgroundColor: cssVar.colorInfoBg,
    backgroundImage: 'none',
  },
});

export const RunTaskRender = memo<BuiltinRenderProps<RunTaskParams, RunTaskState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');

    const params = args ?? ({} as Partial<RunTaskParams>);
    const identifier = pluginState?.identifier ?? params.identifier;
    const prompt = params.prompt;
    const continueTopic = !!params.continueTopicId;
    const topicId = pluginState?.topicId;

    const hasBody = !!prompt || continueTopic || !!topicId;

    return (
      <TaskResultCard
        icon={Play}
        iconColor={cssVar.colorWarning}
        identifier={identifier}
        taskId={resolveTaskOpenTarget(pluginState, params)}
        title={t('builtins.lobe-task.apiName.runTask')}
      >
        {hasBody ? (
          <>
            {continueTopic && (
              <span {...stylex.props(styles.topicChip)}>
                {t('builtins.lobe-task.run.continueTopic')}
              </span>
            )}
            {prompt && (
              <SectionField label={t('builtins.lobe-task.run.prompt')}>
                <Markdown fontSize={12} variant={'chat'}>
                  {prompt}
                </Markdown>
              </SectionField>
            )}
            {topicId && (
              <InlineField label={t('builtins.lobe-task.run.topic')}>
                <span className={monoChipClassName}>{topicId}</span>
              </InlineField>
            )}
          </>
        ) : null}
      </TaskResultCard>
    );
  },
);

RunTaskRender.displayName = 'RunTaskRender';

export default RunTaskRender;
