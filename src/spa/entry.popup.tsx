import '../initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { createAppRouter } from '@/utils/router';

import { popupRoutes } from './router/popupRouter.config';

const router = createAppRouter(popupRoutes);

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
