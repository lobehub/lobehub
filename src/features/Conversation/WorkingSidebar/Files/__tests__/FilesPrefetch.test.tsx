import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as unknown[][]);

vi.mock('../useFilesTreeSources', () => ({
  useFilesTreeSources: (...args: unknown[]) => {
    calls.push(args);
  },
}));

const { default: FilesPrefetch } = await import('../FilesPrefetch');

describe('FilesPrefetch', () => {
  it('warms a sandbox tree once instead of enabling live polling', () => {
    render(<FilesPrefetch sandboxInstanceId={'instance-1'} workingDirectory={''} />);

    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ instanceId: 'instance-1', live: false });
  });
});
