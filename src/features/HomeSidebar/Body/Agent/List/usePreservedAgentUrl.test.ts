import { AGENT_CHAT_URL } from '@lobechat/const';
import { act, render } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { resolvePreservedAgentUrl, usePreservedAgentUrl } from './usePreservedAgentUrl';

describe('resolvePreservedAgentUrl', () => {
  it('keeps an agent-scoped subview when switching agents', () => {
    expect(resolvePreservedAgentUrl('/agent/agt_a/topics', 'agt_b')).toBe('/agent/agt_b/topics');
    expect(resolvePreservedAgentUrl('/agent/agt_a/profile', 'agt_b')).toBe('/agent/agt_b/profile');
  });

  it('drops topic and task ids that belong to the previous agent', () => {
    expect(resolvePreservedAgentUrl('/agent/agt_a/topic/tpc_1', 'agt_b')).toBe(
      AGENT_CHAT_URL('agt_b', false),
    );
  });

  it('does not rerender when navigation keeps the resolved agent url unchanged', async () => {
    let renders = 0;
    let resolvedUrl = '';
    const Probe = () => {
      renders += 1;
      resolvedUrl = usePreservedAgentUrl('agt_b');
      return null;
    };
    const router = createMemoryRouter([{ element: React.createElement(Probe), path: '*' }], {
      initialEntries: ['/tasks'],
    });

    render(React.createElement(RouterProvider, { router }));

    await act(() => router.navigate('/agents'));

    expect(resolvedUrl).toBe(AGENT_CHAT_URL('agt_b', false));
    expect(renders).toBe(1);

    await act(() => router.navigate('/agent/agt_a/profile'));

    expect(resolvedUrl).toBe('/agent/agt_b/profile');
    expect(renders).toBe(2);
  });
});
