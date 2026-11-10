import { isDesktop } from '@lobechat/const';
import type { LocalAsrStatus } from '@lobechat/electron-client-ipc';

import { CloudRealtimeTranscriber } from './cloud';
import { LocalBatchTranscriber, LocalRealtimeTranscriber } from './local';
import type { BatchTranscriber, RealtimeTranscriber, TranscriptionProvider } from './transcriber';

export * from './transcriber';

/**
 * Pick the realtime transcriber for a provider. Callers only see the shared
 * interface, so switching the desktop "local / cloud" preference needs no
 * branching at the call site. Web always gets cloud.
 */
export const createRealtimeTranscriber = (provider: TranscriptionProvider): RealtimeTranscriber =>
  provider === 'local' && isDesktop
    ? new LocalRealtimeTranscriber()
    : new CloudRealtimeTranscriber();

/** On-device refine (desktop, local provider). Cloud refine runs server-side. */
export const createLocalBatchTranscriber = (): BatchTranscriber => new LocalBatchTranscriber();

/**
 * The provider that will actually run: a saved "local" choice falls back to cloud
 * while this device cannot run the engine or the speech model is not installed.
 */
export const resolveTranscriptionProvider = (
  status: Pick<LocalAsrStatus, 'hardware' | 'packs' | 'preferences'>,
): TranscriptionProvider => {
  if (status.preferences.provider !== 'local') return 'cloud';
  const asrReady = status.packs.some(
    (pack) => pack.id === 'asr-sensevoice' && pack.status === 'ready',
  );
  return asrReady && status.hardware.tier !== 'unsupported' ? 'local' : 'cloud';
};
