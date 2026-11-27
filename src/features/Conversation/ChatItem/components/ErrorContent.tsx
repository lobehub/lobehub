import { type InterfaceDensity } from '@lobechat/types';
import { Alert, Button, cx, Skeleton } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { RotateCcw } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';
import { useDensity } from '@/styles/density';
import { densityTokens } from '@/styles/density.stylex';

import { type ChatItemProps } from '../type';

const NARROW = '@media (width <= 480px)';

const CLOSE_SIZE = {
  compact: '24px',
  loose: null,
} as const satisfies Record<InterfaceDensity, string | null>;

const EXTRA_HEADER_PADDING_BLOCK = {
  compact: '4px',
  loose: null,
} as const satisfies Record<InterfaceDensity, string | null>;

const EXTRA_HEADER_PADDING_INLINE = {
  compact: '10px',
  loose: null,
} as const satisfies Record<InterfaceDensity, string | null>;

const ROOT_PADDING_BLOCK = {
  compact: '6px',
  loose: null,
} as const satisfies Record<InterfaceDensity, string | null>;

const ROOT_PADDING_INLINE = {
  compact: '10px',
  loose: null,
} as const satisfies Record<InterfaceDensity, string | null>;

const styles = stylex.create({
  close: {
    width: { default: CLOSE_SIZE.loose, [NARROW]: '24px' },
    height: { default: CLOSE_SIZE.loose, [NARROW]: '24px' },
  },
  closeCompact: {
    width: CLOSE_SIZE.compact,
    height: CLOSE_SIZE.compact,
  },
  extraContent: {
    padding: 0,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    marginInline: { default: null, [NARROW]: '8px' },
  },
  extraHeader: {
    paddingBlock: EXTRA_HEADER_PADDING_BLOCK.loose,
    paddingInline: { default: EXTRA_HEADER_PADDING_INLINE.loose, [NARROW]: '8px' },
  },
  extraHeaderCompact: {
    minHeight: 'auto',
    paddingBlock: EXTRA_HEADER_PADDING_BLOCK.compact,
    paddingInline: { default: EXTRA_HEADER_PADDING_INLINE.compact, [NARROW]: '8px' },
  },
  root: {
    gap: { default: null, [NARROW]: '6px' },
    paddingBlock: ROOT_PADDING_BLOCK.loose,
    paddingInline: { default: ROOT_PADDING_INLINE.loose, [NARROW]: '8px' },
  },
  rootCompact: {
    paddingBlock: ROOT_PADDING_BLOCK.compact,
    paddingInline: { default: ROOT_PADDING_INLINE.compact, [NARROW]: '8px' },
  },
  title: {
    fontSize: densityTokens['--lobe-density-font-size'],
  },
});

export interface ErrorContentProps {
  customErrorRender?: ChatItemProps['customErrorRender'];
  error: ChatItemProps['error'];
  id?: string;
  onRegenerate?: () => void;
}

const ErrorContent = memo<ErrorContentProps>(({ customErrorRender, error, id, onRegenerate }) => {
  const { t } = useTranslation('common');
  const { compact } = useDensity();
  const [deleteMessage, updateMessageError] = useConversationStore((s) => [
    s.deleteMessage,
    s.updateMessageError,
  ]);
  const messageContent = useConversationStore((s) =>
    id ? dataSelectors.getDisplayMessageById(id)(s)?.content : undefined,
  );
  // The retry can take a while to produce anything visible (branch switch plus a
  // transport round trip), so the button has to own its own pending state —
  // otherwise a click reads as "nothing happened" and invites a second one.
  const retrying = useConversationStore((s) =>
    id ? messageStateSelectors.isMessageRegenerating(id)(s) : false,
  );

  if (!error) return;

  if (customErrorRender) {
    return <Suspense fallback={<Skeleton height={36} />}>{customErrorRender(error)}</Suspense>;
  }

  return (
    <Alert
      closable
      showIcon
      extraIsolate={false}
      type={'secondary'}
      variant={'outlined'}
      action={
        onRegenerate && (
          <Button
            disabled={retrying}
            icon={<RotateCcw size={14} />}
            loading={retrying}
            size="small"
            type="fill"
            onClick={onRegenerate}
          >
            {t('regenerate')}
          </Button>
        )
      }
      {...error}
      title={error.message}
      afterClose={() => {
        error?.afterClose?.();
        if (!id) return;
        // A turn can carry a terminal error on top of content it already
        // streamed. Dismissing the error must not delete that content — just
        // clear the error and keep the message.
        if (messageContent && messageContent.trim() !== '') {
          updateMessageError(id, null);
        } else {
          deleteMessage(id);
        }
      }}
      classNames={{
        ...error.classNames,
        close: cx(
          stylex.props(styles.close, compact && styles.closeCompact).className,
          error.classNames?.close,
        ),
        extraContent: cx(
          stylex.props(styles.extraContent).className,
          error.classNames?.extraContent,
        ),
        extraHeader: cx(
          stylex.props(styles.extraHeader, compact && styles.extraHeaderCompact).className,
          error.classNames?.extraHeader,
        ),
        root: cx(
          stylex.props(styles.root, compact && styles.rootCompact).className,
          error.classNames?.root,
        ),
        title: cx(stylex.props(styles.title).className, error.classNames?.title),
      }}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        ...error.style,
      }}
    />
  );
});

export default ErrorContent;
