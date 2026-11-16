import { Button, cssVar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The stop glyph of `@lobehub/editor`'s `SendButton` without its spinning arc: the
 * running state is shown once, by `RunningIndicator`, so Stop stays still.
 */
const StopGlyph = memo<{ size: number }>(({ size }) => (
  <svg fill="none" height={size} viewBox="0 0 1024 1024" width={size}>
    <circle cx="512" cy="512" r="426" stroke={cssVar.colorBorder} strokeWidth="72" />
    <rect fill="currentColor" height="252" rx="24" ry="24" width="252" x="386" y="386" />
  </svg>
));

StopGlyph.displayName = 'StopGlyph';

interface StopButtonProps {
  onStop: () => void;
  shape?: 'round' | 'default';
  size?: number;
}

/**
 * Stops the running turn. Drawn here instead of through `SendButton generating`,
 * whose icon spins for the whole run and would duplicate the running indicator.
 */
const StopButton = memo<StopButtonProps>(({ onStop, shape, size = 32 }) => {
  const { t } = useTranslation('chat');

  return (
    <Button
      aria-label={t('input.stop')}
      data-testid="chat-input-stop"
      icon={<StopGlyph size={size * 0.75} />}
      shape={shape}
      style={{ flex: 'none', height: size, paddingInline: 0, width: size }}
      title={t('input.stop')}
      type={'fill'}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onStop();
      }}
    />
  );
});

StopButton.displayName = 'StopButton';

export default StopButton;
