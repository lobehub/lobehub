import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { projectWorkspaceRoute } from './projectWorkspaceRoutes';

const legacyRoute = projectWorkspaceRoute.children?.find(
  (route) => route.path === 'conversation/:topicId?',
);

const Location = () => {
  const { hash, pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}${hash}`}</div>;
};

const renderAt = (url: string) => {
  const router = createMemoryRouter(
    [
      {
        children: [
          { element: <Location />, path: 'topic/:topicId?' },
          { element: legacyRoute?.element, path: 'conversation/:topicId?' },
        ],
        path: ':workspace?/project/:projectId',
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return screen.getByTestId('location').textContent;
};

describe('legacy project conversation links', () => {
  it('moves a topic link to the topic route, keeping its query and hash', async () => {
    expect(renderAt('/project/prj_1/conversation/tpc_1?thread=thd_1#msg_1')).toBe(
      '/project/prj_1/topic/tpc_1?thread=thd_1#msg_1',
    );
  });

  it('moves a draft link without a topic and keeps the workspace prefix', () => {
    expect(renderAt('/acme/project/prj_1/conversation?agent=agt_1&dir=pwd_1')).toBe(
      '/acme/project/prj_1/topic?agent=agt_1&dir=pwd_1',
    );
  });
});
