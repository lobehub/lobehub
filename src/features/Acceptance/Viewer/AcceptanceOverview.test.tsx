import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceOverview } from './AcceptanceOverview';

const bundle = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('./AcceptanceScope', () => ({
  useAcceptanceScope: () => ({ acceptanceId: 'acc-1', embedded: false }),
}));
vi.mock('./useAcceptanceBundle', () => ({
  useAcceptanceBundle: () => ({ data: bundle.current, mutate: vi.fn() }),
}));
vi.mock('./useAcceptanceTurn', () => ({ useAcceptanceTurn: () => ({ turn: undefined }) }));
vi.mock('./turnChecks', () => ({ checksForTurn: () => [] }));
vi.mock('./Comments/hooks', () => ({
  useAcceptanceComments: () => ({ items: [], threads: [] }),
}));
vi.mock('./Comments/discussionTimeline', () => ({ countDiscussionMessages: () => 0 }));
vi.mock('@/services/verify', () => ({ verifyService: { setAcceptanceVisibility: vi.fn() } }));

// Everything else in the page is out of scope here: the test is about which
// header controls the main SPA mounts, not how the record's body renders.
vi.mock('./Checks/AcceptanceCheckInventory', () => ({ default: () => null }));
vi.mock('./Checks/AcceptanceCheckOwnerToolbar', () => ({ default: () => null }));
vi.mock('./Comments/AcceptanceDiscussion', () => ({ default: () => null }));
vi.mock('./Comments/ReviewerApprovalBar', () => ({ default: () => null }));
vi.mock('./Conversation/AcceptanceOriginTopic', () => ({ default: () => null }));
vi.mock('./Evidence/AcceptanceResources', () => ({ default: () => null }));
vi.mock('./Flow/AcceptanceFlow', () => ({ AcceptanceFlow: () => null }));
vi.mock('./Frames/AcceptanceFrames', () => ({ AcceptanceFrames: () => null }));
vi.mock('./Frames/useFrameBoard', () => ({ useFrameBoardData: () => ({ data: null }) }));
vi.mock('./Focus/AcceptanceEnterFocus', () => ({ default: () => null }));
vi.mock('./Gate/GateReview', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceGoal', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceGoalEdit', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceIdentity', () => ({ default: () => <div>identity-stub</div> }));
vi.mock('./Header/AcceptanceStatusControl', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceTabs', () => ({ default: () => null }));
vi.mock('./Review/AcceptanceDecision', () => ({ default: () => null }));

const buildBundle = (overrides: { canReview: boolean; visibility: 'private' | 'public' }) => ({
  acceptance: { id: 'acc-1', visibility: overrides.visibility },
  canReview: overrides.canReview,
  isOwner: overrides.canReview,
  rounds: [],
  subject: { id: 'subject-1', type: 'task' },
});

const renderOverview = () =>
  render(
    <MemoryRouter>
      <AcceptanceOverview />
    </MemoryRouter>,
  );

beforeEach(() => {
  bundle.current = undefined;
});

afterEach(cleanup);

describe('AcceptanceOverview sharing', () => {
  it('mounts the share control for a viewer who can manage the acceptance', async () => {
    bundle.current = buildBundle({ canReview: true, visibility: 'private' });
    renderOverview();

    const share = screen.getByRole('button', { name: /acceptance\.share\.title/ });
    fireEvent.click(share);

    expect(await screen.findByText('acceptance.share.makePublic')).toBeTruthy();
    expect(screen.getByText('report.actions.copyLink')).toBeTruthy();
  });

  it('offers to make a public acceptance private', async () => {
    bundle.current = buildBundle({ canReview: true, visibility: 'public' });
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /acceptance\.share\.title/ }));

    expect(await screen.findByText('acceptance.share.makePrivate')).toBeTruthy();
  });

  it('shows no share control to a viewer who cannot manage the acceptance', () => {
    bundle.current = buildBundle({ canReview: false, visibility: 'public' });
    renderOverview();

    expect(screen.getByText('identity-stub')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /acceptance\.share\.title/ })).toBeNull();
  });
});
