import { createRoot } from 'react-dom/client';

import ScreenCaptureOverlay from './ScreenCaptureOverlay';

const root = createRoot(document.getElementById('root')!);
root.render(<ScreenCaptureOverlay />);
