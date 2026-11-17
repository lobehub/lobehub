import { useEffect } from 'react';
import { VoiceMessageControl } from 'verification:component';

const noop = () => {};
const waveform = [0.1, 0.4, 0.8, 1, 0.6, 0.3, 0.9, 0.2];

const usePointerEnterSendButton = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector('[data-testid="voice-message-pill"] button')
        ?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
};

export const Fixture = ({ variant }: { variant: string }) => {
  const kind = variant.replace(/^dark-/, '');
  const busy = kind === 'busy';
  const retry = kind.startsWith('retry');
  usePointerEnterSendButton(kind.endsWith('hover-expanded'));
  return (
    <VoiceMessageControl
      actionLabel={retry ? 'Retry' : 'Send'}
      actionText={retry ? 'Retry' : busy ? 'Requesting microphone' : 'Send'}
      cancelLabel="Cancel"
      durationLabel="Duration 0:03"
      errorText={retry ? 'Microphone permission was denied' : undefined}
      expanded={busy}
      groupLabel="Voice message"
      isRetry={retry}
      progress={kind === 'progress' ? 40 : undefined}
      sendDisabled={kind === 'disabled' || busy}
      statusAnnouncement="Recording"
      tooltip={kind === 'disabled' ? 'Too short' : undefined}
      waveform={waveform}
      onAction={noop}
      onCancel={noop}
    />
  );
};
