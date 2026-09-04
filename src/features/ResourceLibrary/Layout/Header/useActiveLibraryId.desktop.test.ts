import { act, render } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { useActiveLibraryId } from './useActiveLibraryId';

describe('useActiveLibraryId (desktop)', () => {
  it('follows a library ID change in the route store', async () => {
    let activeId = '';
    const Probe = () => {
      activeId = useActiveLibraryId();
      return null;
    };
    const router = createMemoryRouter(
      [{ element: React.createElement(Probe), path: '/resource/library/:id' }],
      { initialEntries: ['/resource/library/library-a'] },
    );

    render(React.createElement(RouterProvider, { router }));
    expect(activeId).toBe('library-a');

    await act(() => router.navigate('/resource/library/library-b'));

    expect(activeId).toBe('library-b');
  });
});
