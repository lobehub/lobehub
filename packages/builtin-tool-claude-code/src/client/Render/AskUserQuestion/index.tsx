'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import type { AskUserQuestionArgs } from '../../../types';

/**
 * CC `askUserQuestion` Render — answered / aborted state only.
 *
 * The pending form lives on the canonical Intervention surface
 * (`BuiltinToolInterventions['claude-code']['askUserQuestion']`) — the
 * framework hides this Render while `pluginIntervention.status === 'pending'`,
 * then yields to it once the user submits / skips and a `tool_result` arrives
 * with the formatted answer text in `content`.
 */
const AskUserQuestion = memo<BuiltinRenderProps<AskUserQuestionArgs, unknown, unknown>>(
  ({ args, content, pluginError }) => {
    const text = typeof content === 'string' ? content : '';
    const isError = !!pluginError;
    return (
      <Block padding={12} variant="outlined" width="100%">
        <Flexbox gap={8}>
          {(args?.questions ?? []).map((q, idx) => (
            <Text key={idx} type="secondary">
              {q.question}
            </Text>
          ))}
          {text && <Text>{text}</Text>}
          {isError && (
            <Text type="warning">(No answer received — model continued without their input.)</Text>
          )}
        </Flexbox>
      </Block>
    );
  },
);

AskUserQuestion.displayName = 'CCAskUserQuestion';

export default AskUserQuestion;
