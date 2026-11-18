/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isPullRequestUrl, useLinkPullRequestField } from './useLinkPullRequestField';

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('@lobehub/ui', () => ({ toast: toastMocks }));

describe('isPullRequestUrl', () => {
  it('accepts a github.com PR page, also a tab of it', () => {
    expect(isPullRequestUrl(' https://github.com/a/b/pull/1 ')).toBe(true);
    expect(isPullRequestUrl('https://github.com/a/b/pull/1/files?w=1')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPullRequestUrl('https://github.com/a/b/issues/1')).toBe(false);
    expect(isPullRequestUrl('https://gitlab.com/a/b/pull/1')).toBe(false);
    expect(isPullRequestUrl('a/b#1')).toBe(false);
  });
});

describe('useLinkPullRequestField', () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = (onLink = vi.fn(async () => 'a/b#1')) => {
    const onDone = vi.fn();
    const hook = renderHook(() => useLinkPullRequestField(onLink, onDone));
    return { hook, onDone, onLink };
  };

  it('links a pasted PR URL, confirms it, and closes the dialog', async () => {
    const { hook, onDone, onLink } = setup();

    act(() => hook.result.current.change(' https://github.com/a/b/pull/1 '));
    await act(() => hook.result.current.submit());

    expect(onLink).toHaveBeenCalledWith('https://github.com/a/b/pull/1');
    expect(toastMocks.success).toHaveBeenCalledWith(
      'workingPanel.overview.pr.linked:{"name":"a/b#1"}',
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('explains a URL that is not a PR without asking the server', async () => {
    const { hook, onDone, onLink } = setup();

    act(() => hook.result.current.change('https://github.com/a/b/issues/1'));
    await act(() => hook.result.current.submit());

    expect(hook.result.current.invalid).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    // Typing again clears the explanation.
    act(() => hook.result.current.change('https://github.com/a/b/pull/2'));
    expect(hook.result.current.invalid).toBe(false);
  });

  it('reports a failed link and keeps the dialog open', async () => {
    const { hook, onDone } = setup(
      vi.fn(async () => {
        throw new Error('nope');
      }),
    );

    act(() => hook.result.current.change('https://github.com/a/b/pull/1'));
    await act(() => hook.result.current.submit());

    expect(toastMocks.error).toHaveBeenCalledWith('workingPanel.overview.pr.linkFailed');
    expect(onDone).not.toHaveBeenCalled();
    expect(hook.result.current.linking).toBe(false);
  });
});
