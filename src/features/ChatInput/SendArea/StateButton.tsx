import { Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface StateButtonProps {
  shape?: 'round' | 'default';
  size?: number;
}

/**
 * Send and its other states share one solid button of a fixed size; only the glyph
 * changes, as in Codex's composer. `@lobehub/editor`'s `SendButton` cannot do this:
 * its `loading` also disables the button, which grays it out, and its `generating`
 * Stop spins for the whole run.
 */
const buttonStyle = (size: number) => ({
  flex: 'none',
  height: size,
  paddingInline: 0,
  width: size,
});

/**
 * Stops the running turn. A plain square, still: the run itself is indicated once,
 * by `RunningIndicator` beside the model selector.
 */
export const StopButton = memo<StateButtonProps & { onStop: () => void }>(
  ({ onStop, shape, size = 32 }) => {
    const { t } = useTranslation('chat');
    const glyph = Math.round(size * 0.34);

    return (
      <Button
        aria-label={t('input.stop')}
        data-testid="chat-input-stop"
        shape={shape}
        style={buttonStyle(size)}
        title={t('input.stop')}
        type={'primary'}
        icon={
          <svg aria-hidden height={glyph} viewBox="0 0 10 10" width={glyph}>
            <rect fill="currentColor" height="10" rx="2" width="10" />
          </svg>
        }
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onStop();
        }}
      />
    );
  },
);

StopButton.displayName = 'StopButton';

/**
 * A send that is committed but not out yet (uploads settling, the message being
 * created): the Send button keeps its color and shows a spinner in place of the arrow.
 * `loading` already blocks clicks; it also marks the button `aria-disabled`, which the
 * Button styles dim to half opacity, so opacity is pinned back to full.
 */
export const PendingSendButton = memo<StateButtonProps>(({ shape, size = 32 }) => {
  const { t } = useTranslation('chat');

  return (
    <Button
      loading
      aria-label={t('input.send')}
      data-testid="chat-input-send-pending"
      shape={shape}
      style={{ ...buttonStyle(size), cursor: 'default', opacity: 1 }}
      type={'primary'}
    />
  );
});

PendingSendButton.displayName = 'PendingSendButton';
