/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicPullRequestProbes from './TopicPullRequestProbes';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), read: vi.fn() }));

vi.mock('@/store/device', () => ({
  useFetchGitPullRequestDetail: (...args: unknown[]) => {
    mocks.read(...args);
    return { mutate: mocks.mutate };
  },
}));

describe('TopicPullRequestProbes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads each linked PR on the device without polling', () => {
    render(
      <TopicPullRequestProbes deviceId="d1" path="/repo" probes={[{ number: 3, version: 1 }]} />,
    );

    expect(mocks.read).toHaveBeenCalledWith('d1', '/repo', 3, { active: false });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('re-reads a PR as soon as the topic links it again (e.g. the agent merged it)', () => {
    const { rerender } = render(
      <TopicPullRequestProbes path="/repo" probes={[{ number: 3, version: 1 }]} />,
    );
    rerender(<TopicPullRequestProbes path="/repo" probes={[{ number: 3, version: 2 }]} />);

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it('reads nothing without a working directory', () => {
    render(<TopicPullRequestProbes probes={[{ number: 3, version: 1 }]} />);

    expect(mocks.read).not.toHaveBeenCalled();
  });
});
