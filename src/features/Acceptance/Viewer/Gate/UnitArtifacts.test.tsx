import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UnitArtifacts from './UnitArtifacts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const openWork = vi.fn();
vi.mock('@/features/WorkGallery/useOpenWork', () => ({ useOpenWork: () => openWork }));
vi.mock('@/features/Work/WorkSummaryCard', () => ({
  default: ({ item, onOpen }: { item: { title: string }; onOpen: (item: unknown) => void }) => (
    <button type="button" onClick={() => onOpen(item)}>
      work-card:{item.title}
    </button>
  ),
}));

const unit = (patch: Record<string, unknown>) =>
  ({ nodeId: 'n1', runs: 1, status: 'resolved', title: 'Unit', tokens: 0, ...patch }) as any;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnitArtifacts', () => {
  /**
   * Regression: the review drew its own output rows instead of the Work cards
   * the conversation lists under a reply, so the same PR looked different in
   * the two places.
   */
  it("lists a unit's outputs with the conversation's Work cards and opens them", () => {
    const work = { id: 'work_1', title: 'Move inbox reads to replica' };
    render(
      <UnitArtifacts
        unit={unit({
          artifacts: [
            { title: work.title, type: 'external', url: 'https://example.com', workId: 'work_1' },
          ],
          works: [work],
        })}
      />,
    );
    fireEvent.click(screen.getByText('work-card:Move inbox reads to replica'));
    expect(openWork).toHaveBeenCalledWith(work);
  });

  /**
   * Regression: the gate's unit panel showed a unit's outputs as small gray
   * title links, without a pull request's number or state, so the owner could
   * not see what was ready to merge.
   */
  it('lists a pull request with its number and state, and opens it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <UnitArtifacts
        unit={unit({
          artifacts: [
            {
              identifier: '#22737',
              resourceType: 'github_pull_request',
              status: 'open',
              title: 'Move inbox reads to replica',
              type: 'external',
              url: 'https://github.com/lobehub/lobehub/pull/22737',
            },
          ],
        })}
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
        unit={unit({
          artifacts: [{ title: 'Notes', type: 'external', url: 'javascript:alert(1)' }],
        })}
      />,
    );
    fireEvent.click(screen.getByText('Notes'));
    expect(open).not.toHaveBeenCalled();
  });

  it('says so when the unit registered no outputs', () => {
    render(<UnitArtifacts unit={unit({ artifacts: [] })} />);
    expect(screen.getByText('acceptance.gate.unitArtifactsEmpty')).toBeInTheDocument();
  });
});
