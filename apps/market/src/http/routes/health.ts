import { Hono } from 'hono';

export const createHealthRoutes = () => {
  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      service: 'lobehub-internal-market',
      status: 'ok',
    }),
  );

  return app;
};
