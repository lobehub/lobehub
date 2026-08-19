import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/homeRedirect.tsx'),
  route('agent/:aid/docs/:docId', 'routes/agentDoc.tsx'),
  route('acceptance', 'layouts/acceptanceNamespace.tsx', [
    index('routes/acceptanceIndex.tsx'),
    route(':acceptanceId', 'routes/acceptanceDetail.tsx'),
    route(':acceptanceId/check/:checkId', 'routes/acceptanceDetailCheck.tsx'),
  ]),
  route('verify', 'layouts/verifyNamespace.tsx', [
    index('routes/verifyList.tsx'),
    route(':runId', 'routes/verifyDetail.tsx'),
  ]),
  route('*', 'routes/catchall.tsx'),
] satisfies RouteConfig;
