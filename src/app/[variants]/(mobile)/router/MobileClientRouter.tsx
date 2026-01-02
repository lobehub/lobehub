'use client';

import { BrowserRouter, Routes } from 'react-router-dom';

import { renderRoutes } from '@/utils/router';

import { mobileRoutes } from './mobileRouter.config';

const ClientRouter = () => {
  return (
    <BrowserRouter>
      <Routes>{renderRoutes(mobileRoutes)}</Routes>
    </BrowserRouter>
  );
};

ClientRouter.displayName = 'ClientRouter';

export default ClientRouter;
