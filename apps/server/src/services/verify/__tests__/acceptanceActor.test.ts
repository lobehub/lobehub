// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

/**
 * An elevated write — a workspace owner acting on a teammate's delivery — is
 * scoped to the row's OWNER so the ownership predicate can resolve a private
 * row at all. The person credited must still be the one who decided.
 */
describe('AcceptanceService actor attribution', () => {
  const db = {} as never;

  it('credits the acting user, not the scope it had to bind to', () => {
    const service = new AcceptanceService(db, 'creator', 'ws_a', {
      actorUserId: 'workspace-owner',
    });

    expect(Reflect.get(service, 'userId')).toBe('creator');
    expect(Reflect.get(service, 'actorUserId')).toBe('workspace-owner');
  });

  it('credits the bound user when no separate actor is given', () => {
    const service = new AcceptanceService(db, 'creator', 'ws_a');

    expect(Reflect.get(service, 'actorUserId')).toBe('creator');
  });
});
