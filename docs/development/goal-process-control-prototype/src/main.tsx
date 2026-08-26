import { createRoot } from 'react-dom/client';

import { App } from './App';

document.querySelector('#boot')?.remove();
createRoot(document.querySelector('#root')!).render(<App />);
