import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UnitArtifacts from './UnitArtifacts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnitArtifacts', () => {
  /**
   * Regression: the gate's unit panel showed a unit's outputs as small gray
   * title links, without a pull request's number or state, so the owner could
   * not see what was ready to merge.
   */
  it('lists a pull request with its number and state, and opens it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <UnitArtifacts
        artifacts={[
          {
            identifier: '#22737',
            resourceType: 'github_pull_request',
            status: 'open',
            title: 'Move inbox reads to replica',
            type: 'external',
            url: 'https://github.com/lobehub/lobehub/pull/22737',
          },
        ]}
      />,
    );

    expect(screen.getByText('acceptance.gate.unitArtifacts')).toBeInTheDocument();
    expect(screen.getByText('#22737 · metaCard.pr.open')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Move inbox reads to replica'));
    expect(open).toHaveBeenCalledWith(
      'https://github.com/lobehub/lobehub/pull/22737',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('does not offer to open an output with an unsafe url', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <UnitArtifacts
        artifacts={[{ title: 'Notes', type: 'external', url: 'javascript:alert(1)' }]}
      />,
    );
    fireEvent.click(screen.getByText('Notes'));
    expect(open).not.toHaveBeenCalled();
  });

  it('says so when the unit registered no outputs', () => {
    render(<UnitArtifacts artifacts={[]} />);
    expect(screen.getByText('acceptance.gate.unitArtifactsEmpty')).toBeInTheDocument();
  });
});
