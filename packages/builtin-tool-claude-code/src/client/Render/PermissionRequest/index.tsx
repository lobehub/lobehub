'use client';

import {
  CLAUDE_CODE_PERMISSION_NOTE_KEY,
  type ClaudeCodePermissionInterventionArgs,
  type ClaudeCodePermissionOptionId,
} from '@lobechat/heterogeneous-agents/claudeCodePermission/shared';
import {
  type AskUserQuestionResultState,
  resolveAskUserAnswers,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, CircleSlash, ClipboardList, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  plan: {
    overflowY: 'auto',
    maxHeight: '240px',
    paddingBlock: '4px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
});

const DENIALS = new Set<ClaudeCodePermissionOptionId>(['deny', 'keep_planning']);

/**
 * A Claude Code permission request after it was answered: what the user chose
 * (and the note sent with a denial), or that the run stopped first. An
 * approved plan stays readable here.
 */
const PermissionRequestResult = memo<
  BuiltinRenderProps<ClaudeCodePermissionInterventionArgs, AskUserQuestionResultState, string>
>(({ args, content, pluginState }) => {
  const { t } = useTranslation('tool');
  const detail = args.claudeCodePermission;
  const answers = resolveAskUserAnswers(pluginState, content);
  const option = Object.entries(answers ?? {})
    .filter(([key]) => key !== CLAUDE_CODE_PERMISSION_NOTE_KEY)
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .find((value): value is ClaudeCodePermissionOptionId =>
      detail.options.includes(value as ClaudeCodePermissionOptionId),
    );
  const note = answers?.[CLAUDE_CODE_PERMISSION_NOTE_KEY];

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon
          size={14}
          icon={
            !option
              ? CircleSlash
              : DENIALS.has(option)
                ? X
                : detail.kind === 'exitPlan'
                  ? ClipboardList
                  : Check
          }
        />
        <Text fontSize={13}>
          {t(`claudeCode.permission.result.${option ?? 'cancelled'}`)}
          {detail.kind === 'tool' ? ` · ${detail.displayName ?? detail.toolName}` : ''}
        </Text>
      </Flexbox>
      {typeof note === 'string' && note && (
        <Text fontSize={12} type={'secondary'}>
          {t('claudeCode.permission.result.note', { note })}
        </Text>
      )}
      {detail.kind === 'exitPlan' && detail.plan && (
        <div {...stylex.props(styles.plan)}>
          <Markdown variant={'chat'}>{detail.plan}</Markdown>
        </div>
      )}
    </Flexbox>
  );
});

PermissionRequestResult.displayName = 'CCPermissionRequestResult';

export default PermissionRequestResult;
