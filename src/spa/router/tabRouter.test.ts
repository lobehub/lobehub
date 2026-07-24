import { describe, expect, it } from 'vitest';

import { createMainAreaChildren } from './desktopRouter.config';
import { createTabRouter } from './tabRouter';

const matchedPaths = (router: ReturnType<typeof createTabRouter>) =>
  router.state.matches.map((match) => match.route.path);

describe('createTabRouter', () => {
  it('matches the agent chat route for /agent/abc', () => {
    const router = createTabRouter('/agent/abc');
    const paths = matchedPaths(router);

    expect(router.state.location.pathname).toBe('/agent/abc');
    expect(paths).toContain('agent');
    expect(paths).toContain(':aid');
  });

  it('matches a nested agent route for /agent/abc/topics', () => {
    const paths = matchedPaths(createTabRouter('/agent/abc/topics'));

    expect(paths).toContain(':aid');
    expect(paths).toContain('topics');
  });

  it('matches the workspace-mirrored agent route for /my-team/agent/abc', () => {
    const paths = matchedPaths(createTabRouter('/my-team/agent/abc'));

    expect(paths).toContain(':workspaceSlug');
    expect(paths).toContain('agent');
    expect(paths).toContain(':aid');
  });

  it('matches the catch-all route for an unknown URL', () => {
    const paths = matchedPaths(createTabRouter('/definitely/not/a/route'));

    expect(paths.at(-1)).toBe('*');
  });

  it('creates independent instances for different URLs', () => {
    const first = createTabRouter('/agent/abc');
    const second = createTabRouter('/image');

    expect(first.state.location.pathname).toBe('/agent/abc');
    expect(second.state.location.pathname).toBe('/image');
    expect(first.state.location.pathname).not.toBe(second.state.location.pathname);
  });
});

describe('createMainAreaChildren', () => {
  it('returns a fresh array instance of the same length on each call', () => {
    const first = createMainAreaChildren();
    const second = createMainAreaChildren();

    expect(first).not.toBe(second);
    expect(first).toHaveLength(second.length);
  });
});
