import { describe, expect, it } from 'vitest';

import {
  SkillConnectionMarketAuthRequiredError,
  SkillConnectionPopupBlockedError,
} from './useSkillConnection';
import { resolveTaskTemplateConnectErrorMessageKey } from './useTaskTemplateCreate';

describe('resolveTaskTemplateConnectErrorMessageKey', () => {
  it('suppresses task template toast when Market auth interrupted the connector flow', () => {
    expect(
      resolveTaskTemplateConnectErrorMessageKey(new SkillConnectionMarketAuthRequiredError()),
    ).toBeUndefined();
  });

  it('keeps the popup-blocked message for OAuth popup failures', () => {
    expect(resolveTaskTemplateConnectErrorMessageKey(new SkillConnectionPopupBlockedError())).toBe(
      'action.connect.popupBlocked',
    );
  });

  it('falls back to the generic connector error for other failures', () => {
    expect(resolveTaskTemplateConnectErrorMessageKey(new Error('network failed'))).toBe(
      'action.connect.error',
    );
  });
});
