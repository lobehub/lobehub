import type { LobeToolCustomPlugin } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { planOAuthSave } from './oauthSavePlan';

const URL = 'https://mail.example.com/mcp';

const valuesWith = (auth: Record<string, unknown>) =>
  ({
    customParams: { mcp: { auth, type: 'http', url: URL } },
    identifier: 'mail',
    type: 'customPlugin',
  }) as LobeToolCustomPlugin;

/**
 * The save button opens the authorization window only when this says so; the
 * edit form used to open it on every OAuth save.
 */
describe('planOAuthSave', () => {
  it('saves in place when the caller says the edit keeps the accounts', () => {
    const notice = { text: 'keeps accounts', type: 'info' as const };
    const getOAuthPlan = vi.fn(() => ({ authorize: false, notice }));

    expect(
      planOAuthSave({
        enableOAuth: true,
        getOAuthPlan,
        values: valuesWith({ clientId: 'id', clientSecret: 'secret', type: 'oauth2' }),
      }),
    ).toEqual({ authorize: false, notice });
    // The caller decides from exactly the fields being saved.
    expect(getOAuthPlan).toHaveBeenCalledWith({ clientId: 'id', clientSecret: 'secret', url: URL });
  });

  it('authorizes when the caller says so', () => {
    expect(
      planOAuthSave({
        enableOAuth: true,
        getOAuthPlan: () => ({ authorize: true }),
        values: valuesWith({ type: 'oauth2' }),
      }).authorize,
    ).toBe(true);
  });

  it('authorizes every OAuth save without a caller plan (creating a connector)', () => {
    expect(planOAuthSave({ enableOAuth: true, values: valuesWith({ type: 'oauth2' }) })).toEqual({
      authorize: true,
    });
  });

  it('never authorizes another auth type, or a form without connector OAuth', () => {
    const getOAuthPlan = vi.fn(() => ({ authorize: true }));

    expect(
      planOAuthSave({ enableOAuth: true, getOAuthPlan, values: valuesWith({ type: 'bearer' }) })
        .authorize,
    ).toBe(false);
    expect(planOAuthSave({ getOAuthPlan, values: valuesWith({ type: 'oauth2' }) }).authorize).toBe(
      false,
    );
    expect(getOAuthPlan).not.toHaveBeenCalled();
  });
});
