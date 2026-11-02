import type { ExpertiseLessonItem, ExpertiseLessonRevisionItem } from '@lobechat/database/schemas';
import { describe, expect, it } from 'vitest';

import { resolveExpertiseApproval, toExpertiseCandidate } from './retrieval';

const lesson = (overrides: Partial<ExpertiseLessonItem> = {}): ExpertiseLessonItem =>
  ({
    code: 'P-01',
    currentRevision: 2,
    domainId: 'domain-1',
    id: 'lesson-1',
    sections: [
      { body: 'Always keep a rollback path.', key: 'rule' },
      { body: 'Rollback prevents unrecoverable releases.', key: 'why' },
    ],
    status: 'active',
    title: 'Keep rollback',
    ...overrides,
  }) as ExpertiseLessonItem;

const revision = (
  overrides: Partial<ExpertiseLessonRevisionItem> = {},
): ExpertiseLessonRevisionItem =>
  ({
    changedBy: 'user',
    id: 'revision-1',
    lessonId: 'lesson-1',
    revision: 2,
    sections: lesson().sections,
    ...overrides,
  }) as ExpertiseLessonRevisionItem;

describe('resolveExpertiseApproval', () => {
  it('treats rejected and retired lessons as revoked', () => {
    expect(resolveExpertiseApproval({ lesson: lesson({ status: 'rejected' }) })).toEqual({
      state: 'revoked',
    });
    expect(resolveExpertiseApproval({ lesson: lesson({ status: 'retired' }) })).toEqual({
      state: 'revoked',
    });
  });

  it('does not approve a lesson that has no revision evidence', () => {
    expect(
      resolveExpertiseApproval({ lesson: lesson({ currentRevision: 1, status: 'active' }) }),
    ).toEqual({ state: 'pending' });
  });

  it('approves only a matching latest revision written by the user', () => {
    expect(
      resolveExpertiseApproval({
        latestRevision: revision(),
        lesson: lesson(),
      }),
    ).toMatchObject({ state: 'approved' });
  });

  it('keeps agent- and system-authored revisions as unapproved proposals', () => {
    expect(
      resolveExpertiseApproval({
        latestRevision: revision({ changedBy: 'agent' }),
        lesson: lesson(),
      }),
    ).toEqual({ state: 'pending' });
    expect(
      resolveExpertiseApproval({
        latestRevision: revision({ changedBy: 'system' }),
        lesson: lesson(),
      }),
    ).toEqual({ state: 'pending' });
  });

  it('marks a missing current revision as stale', () => {
    expect(
      resolveExpertiseApproval({
        latestRevision: revision({ revision: 1 }),
        lesson: lesson({ currentRevision: 2 }),
      }),
    ).toEqual({ state: 'stale' });
  });

  it('marks content drift as a hash mismatch', () => {
    const approval = resolveExpertiseApproval({
      latestRevision: revision({
        sections: [{ body: 'A different approved body.', key: 'rule' }],
      }),
      lesson: lesson(),
    });

    expect(approval.state).toBe('hash_mismatch');
    expect(approval.approvedContentHash).toMatch(/^md5:/);
  });
});

describe('toExpertiseCandidate', () => {
  it('uses the binding grant as the visible personal scope owner', () => {
    const candidate = toExpertiseCandidate({
      latestRevision: revision(),
      row: {
        bindingAgentId: null,
        bindingUserId: 'user-current',
        bindingWorkspaceId: null,
        domainId: 'domain-1',
        domainUserId: 'user-domain-owner',
        domainVisibility: 'public',
        domainWorkspaceId: null,
        lesson: lesson(),
      },
      scope: { db: {} as never, userId: 'user-current' },
    });

    expect(candidate).toMatchObject({
      approval: { state: 'approved' },
      authority: 'approved_experience',
      scope: {
        ownerUserId: 'user-current',
        share: 'personal',
        shareGate: 'allowed',
      },
    });
  });
});
