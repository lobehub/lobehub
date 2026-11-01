import { createSPARoot } from '../../../../src/spa/runtime';
import ScreenCaptureOverlay from './ScreenCaptureOverlay';

const root = createSPARoot(document.getElementById('root')!);
root.render(<ScreenCaptureOverlay />);
