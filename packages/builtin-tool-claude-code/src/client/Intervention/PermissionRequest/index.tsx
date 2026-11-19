'use client';

import {
  CLAUDE_CODE_PERMISSION_NOTE_KEY,
  type ClaudeCodePermissionInterventionArgs,
  type ClaudeCodePermissionOptionId,
} from '@lobechat/heterogeneous-agents/claudeCodePermission/shared';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Button, Flexbox, Highlighter, Icon, Markdown, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, ClipboardList, ShieldQuestion } from 'lucide-react';
import { memo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useSubmissionReconcile } from '../useSubmissionReconcile';

const styles = stylex.create({
  detail: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  plan: {
    overflowY: 'auto',
    maxHeight: '360px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  title: { fontSize: '14px', fontWeight: 500, lineHeight: 1.5, color: cssVar.colorText },
});

/** The option the user is most likely to want, drawn as the one primary button. */
const PRIMARY: Partial<Record<ClaudeCodePermissionOptionId, true>> = {
  allow: true,
  approve_accept_edits: true,
};

/** Options that answer "no", which carry the note to Claude. */
const TAKES_NOTE: Partial<Record<ClaudeCodePermissionOptionId, true>> = {
  deny: true,
  keep_planning: true,
};

const previewOf = (input: Record<string, unknown> | undefined) => {
  if (!input) return;
  if (typeof input.command === 'string') return { code: input.command, language: 'bash' };
  if (typeof input.file_path === 'string') return { text: input.file_path };
  if (typeof input.url === 'string') return { text: input.url };
  if (Object.keys(input).length === 0) return;
  return { code: JSON.stringify(input, null, 2), language: 'json' };
};

/**
 * Claude Code asking before it acts (Better Coding Experience permission
 * modes): a tool it wants to run, entering plan mode, or the plan it wants
 * approved. The buttons are Claude Code's own options; a denial or "keep
 * planning" carries the note the user typed, so Claude knows what to do
 * instead. Never times out: Claude Code waits until the user answers or stops
 * the run.
 */
const PermissionRequestIntervention = memo<
  BuiltinInterventionProps<ClaudeCodePermissionInterventionArgs>
>(({ actionsPortalTarget, args, disabled, messageId, onInteractionAction }) => {
  const { t } = useTranslation('tool');
  // A submitted answer whose producer ACK was missed is re-read, not left stuck.
  useSubmissionReconcile(messageId);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The store also says when a submission could not be confirmed.
  const submissionPhase = useChatStore((s) => s.questionSubmissions[messageId]);
  const showFailure = failed || submissionPhase === 'failed' || submissionPhase === 'uncertain';
  const detail = args.claudeCodePermission;
  const question = args.questions[0]?.question ?? '';
  const inert = disabled || sending;

  const answer = async (optionId: ClaudeCodePermissionOptionId) => {
    if (inert || !onInteractionAction) return;
    const trimmed = TAKES_NOTE[optionId] ? note.trim() : '';
    setSending(true);
    setFailed(false);
    try {
      await onInteractionAction({
        payload: {
          [question]: optionId,
          ...(trimmed && { [CLAUDE_CODE_PERMISSION_NOTE_KEY]: trimmed }),
        },
        type: 'submit',
      });
    } catch (error) {
      // The card is back to pending: say the answer did not reach Claude Code,
      // so the user answers again instead of waiting for nothing.
      console.error('[CCPermissionRequest] submit failed', error);
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const title =
    detail.kind === 'exitPlan'
      ? t('claudeCode.permission.exitPlan.title')
      : detail.kind === 'enterPlan'
        ? t('claudeCode.permission.enterPlan.title')
        : (detail.title ??
          t('claudeCode.permission.tool.title', {
            tool: detail.displayName ?? detail.toolName,
          }));
  const preview = detail.kind === 'tool' ? previewOf(detail.input) : undefined;
  const takesNote = detail.options.some((option) => TAKES_NOTE[option]);

  const actions = (
    <Flexbox gap={8}>
      {showFailure && (
        <Text fontSize={12} role="alert" type="danger">
          <Icon icon={CircleAlert} size={14} /> {t('askUserQuestion.submitFailed')}
        </Text>
      )}
      {takesNote && (
        <TextArea
          autoSize={{ maxRows: 4, minRows: 1 }}
          disabled={inert}
          value={note}
          placeholder={t(
            detail.kind === 'exitPlan'
              ? 'claudeCode.permission.planNote.placeholder'
              : 'claudeCode.permission.denyNote.placeholder',
          )}
          onChange={(event) => setNote(event.target.value)}
        />
      )}
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {detail.options.map((option) => (
          <Button
            danger={option === 'deny'}
            disabled={inert}
            key={option}
            size={'small'}
            type={PRIMARY[option] ? 'primary' : 'default'}
            onClick={() => void answer(option)}
          >
            {t(`claudeCode.permission.option.${option}`)}
          </Button>
        ))}
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t(inert ? 'claudeCode.permission.resolving' : 'claudeCode.permission.waiting')}
      </Text>
    </Flexbox>
  );

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={detail.kind === 'tool' ? ShieldQuestion : ClipboardList} size={16} />
        <span {...stylex.props(styles.title)}>{title}</span>
      </Flexbox>

      {detail.kind === 'enterPlan' && (
        <div {...stylex.props(styles.detail)}>{t('claudeCode.permission.enterPlan.desc')}</div>
      )}

      {detail.description && detail.kind === 'tool' && (
        <div {...stylex.props(styles.detail)}>{detail.description}</div>
      )}
      {preview?.code !== undefined && (
        <Highlighter language={preview.language} style={{ maxHeight: 240, overflow: 'auto' }}>
          {preview.code}
        </Highlighter>
      )}
      {preview?.text && <Text code>{preview.text}</Text>}
      {detail.decisionReason && (
        <div {...stylex.props(styles.detail)}>
          {t('claudeCode.permission.tool.reason')}: {detail.decisionReason}
        </div>
      )}
      {detail.blockedPath && (
        <div {...stylex.props(styles.detail)}>
          {t('claudeCode.permission.tool.blockedPath', { path: detail.blockedPath })}
        </div>
      )}

      {detail.kind === 'exitPlan' && detail.plan && (
        <div {...stylex.props(styles.plan)}>
          <Markdown variant={'chat'}>{detail.plan}</Markdown>
        </div>
      )}
      {detail.allowedPrompts && (
        <Flexbox gap={4}>
          <div {...stylex.props(styles.detail)}>
            {t('claudeCode.permission.exitPlan.allowedPrompts')}
          </div>
          {detail.allowedPrompts.map(({ prompt, tool }) => (
            <Text code fontSize={12} key={`${tool}:${prompt}`}>
              {tool}: {prompt}
            </Text>
          ))}
        </Flexbox>
      )}

      {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
    </Flexbox>
  );
});

PermissionRequestIntervention.displayName = 'CCPermissionRequestIntervention';

export default PermissionRequestIntervention;
