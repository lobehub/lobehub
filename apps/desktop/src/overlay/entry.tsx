import { createSPARoot } from '../../../../src/spa/runtime';
import ScreenCaptureOverlay from './ScreenCaptureOverlay';

void window.electronAPI?.invoke?.('screenCapture.traceOverlayEvent', {
  data: { at: Date.now() },
  event: 'perf.entryEvaluated',
});

const root = createSPARoot(document.getElementById('root')!);
root.render(<ScreenCaptureOverlay />);
