import { Button, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  actions: {
    alignItems: 'center',
    display: 'flex',
    gap: 4,
    justifyContent: 'flex-end',
  },
  composer: {
    paddingBlockEnd: 12,
    paddingBlockStart: 2,
    paddingInline: 14,
  },
  hint: {
    color: cssVar.colorTextQuaternary,
    fontSize: 10,
    paddingBlockEnd: 10,
    paddingInline: 14,
  },
  now: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
  },
});

const fieldStyle = {
  fontSize: 'inherit',
  lineHeight: 1.6,
  minHeight: 44,
  padding: 0,
};

interface ComposerProps {
  action: string;
  autoFocus?: boolean;
  hint?: ReactNode;
  nowAction?: string;
  onSend: (text: string, now: boolean) => Promise<unknown>;
  placeholder: string;
}

const Composer = ({ action, autoFocus, hint, nowAction, onSend, placeholder }: ComposerProps) => {
  const { t } = useTranslation('project');
  const [text, setText] = useState('');
  const [sending, setSending] = useState<'add' | 'now' | null>(null);
  const empty = !text.trim();

  const send = async (now: boolean) => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(now ? 'now' : 'add');
    try {
      await onSend(content, now);
      setText('');
    } catch (error) {
      toast.error({
        description: (error as Error).message,
        title: t('artboard.comment.failed'),
      });
    } finally {
      setSending(null);
    }
  };

  return (
    <>
      <div {...stylex.props(styles.composer)}>
        <TextArea
          autoFocus={autoFocus}
          autoSize={{ maxRows: 12, minRows: 1 }}
          disabled={!!sending}
          placeholder={placeholder}
          resize={false}
          style={fieldStyle}
          value={text}
          variant="borderless"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send(false);
            }
          }}
        />
        <div {...stylex.props(styles.actions)}>
          {nowAction && (
            <Button
              disabled={empty || !!sending}
              loading={sending === 'now'}
              size="small"
              type="text"
              onClick={() => send(true)}
              {...stylex.props(styles.now)}
            >
              {nowAction}
            </Button>
          )}
          <Button
            aria-label={action}
            disabled={empty || !!sending}
            icon={<ArrowUp size={15} strokeWidth={2.4} />}
            loading={sending === 'add'}
            shape="circle"
            size="small"
            title={action}
            type="primary"
            onClick={() => send(false)}
          />
        </div>
      </div>
      {hint && <div {...stylex.props(styles.hint)}>{hint}</div>}
    </>
  );
};

export default Composer;
