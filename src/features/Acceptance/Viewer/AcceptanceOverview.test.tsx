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
// Desktop renders from `app://renderer`; shared links must use the server origin instead.
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));

// Everything else in the page is out of scope here: the test is about which
// header controls the main SPA mounts, not how the record's body renders.
vi.mock('./Checks/AcceptanceCheckInventory', () => ({ default: () => null }));
vi.mock('./Checks/AcceptanceCheckOwnerToolbar', () => ({ default: () => null }));
vi.mock('./Comments/AcceptanceDiscussion', () => ({ default: () => null }));
vi.mock('./Comments/ReviewerApprovalBar', () => ({ default: () => null }));
vi.mock('./Comments/CollaborationRequestBanner', () => ({ default: () => null }));
vi.mock('./Conversation/AcceptanceOriginTopic', () => ({ default: () => null }));
vi.mock('./Evidence/AcceptanceResources', () => ({ default: () => null }));
vi.mock('./Flow/AcceptanceFlow', () => ({ AcceptanceFlow: () => null }));
vi.mock('./Focus/AcceptanceEnterFocus', () => ({ default: () => null }));
vi.mock('./Gate/GateReview', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceGoal', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceGoalEdit', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceIdentity', () => ({ default: () => <div>identity-stub</div> }));
vi.mock('./Header/AcceptanceStatusControl', () => ({ default: () => null }));
vi.mock('./Header/AcceptanceTabs', () => ({ default: () => null }));
vi.mock('./Review/AcceptanceDecision', () => ({ default: () => null }));

const buildBundle = (overrides: {
  canReview: boolean;
  isOwner?: boolean;
  visibility: 'owner' | 'private' | 'public';
  workspaceId?: string;
}) => ({
  acceptance: {
    id: 'acc-1',
    visibility: overrides.visibility,
    workspaceId: overrides.workspaceId ?? null,
  },
  canReview: overrides.canReview,
  isOwner: overrides.isOwner ?? overrides.canReview,
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

    expect(await screen.findByText('acceptance.share.access.public')).toBeTruthy();
    expect(screen.getByText('report.actions.copyLink')).toBeTruthy();
  });

  it('copies the acceptance link under the app origin, not the page origin', async () => {
    bundle.current = buildBundle({ canReview: true, visibility: 'private' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /acceptance\.share\.title/ }));
    fireEvent.click(await screen.findByText('report.actions.copyLink'));

    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://app.lobehub.com/acceptance/acc-1'),
    );
  });

  it('offers a personal acceptance only-me and link access', async () => {
    bundle.current = buildBundle({ canReview: true, visibility: 'public' });
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /acceptance\.share\.title/ }));

    expect(await screen.findByText('acceptance.share.access.owner')).toBeTruthy();
    expect(screen.getByText('acceptance.share.access.public')).toBeTruthy();
    expect(screen.queryByText('acceptance.share.access.workspace')).toBeNull();
  });

  it('lets the creator of a workspace acceptance keep it to themselves', async () => {
    bundle.current = buildBundle({ canReview: true, visibility: 'private', workspaceId: 'ws-1' });
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /acceptance\.share\.title/ }));

    expect(await screen.findByText('acceptance.share.access.owner')).toBeTruthy();
    expect(screen.getByText('acceptance.share.access.workspace')).toBeTruthy();
    expect(screen.getByText('acceptance.share.access.public')).toBeTruthy();
  });

  it('does not let a teammate hide a workspace acceptance from the team', async () => {
    bundle.current = buildBundle({
      canReview: true,
      isOwner: false,
      visibility: 'private',
      workspaceId: 'ws-1',
    });
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /acceptance\.share\.title/ }));

    expect(await screen.findByText('acceptance.share.access.workspace')).toBeTruthy();
    expect(screen.queryByText('acceptance.share.access.owner')).toBeNull();
  });

  it('shows no share control to a viewer who cannot manage the acceptance', () => {
    bundle.current = buildBundle({ canReview: false, visibility: 'public' });
    renderOverview();

    expect(screen.getByText('identity-stub')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /acceptance\.share\.title/ })).toBeNull();
  });
});
