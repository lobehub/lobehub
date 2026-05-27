import { createRoot } from 'react-dom/client';

import { perfMark } from './perfMark';
import ScreenCaptureOverlay from './ScreenCaptureOverlay';

perfMark('overlay:react-render');
const root = createRoot(document.getElementById('root')!);
root.render(<ScreenCaptureOverlay />);
