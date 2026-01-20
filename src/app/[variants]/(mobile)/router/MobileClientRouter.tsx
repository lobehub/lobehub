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

export default ClientRouter;
