import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/homeRedirect.tsx'),
  route('share/t/:id', 'routes/shareTopic.tsx'),
  route('share/page/:id', 'routes/sharePage.tsx'),
  route('share/artifact/:id', 'routes/shareArtifact.tsx'),
  route('*', 'routes/catchall.tsx'),
] satisfies RouteConfig;
