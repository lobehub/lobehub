import { describe, expect, it } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { isAcceptancePortalView } from './acceptancePortalView';

describe('isAcceptancePortalView', () => {
  it.each([PortalViewType.Acceptance, PortalViewType.AcceptanceCheck])(
    'hosts %s in the Home drawer',
    (viewType) => {
      expect(isAcceptancePortalView(viewType)).toBe(true);
    },
  );

  it.each([null, PortalViewType.TaskDetail, PortalViewType.VerifyReport])(
    'leaves unrelated portal view %s to its owning surface',
    (viewType) => {
      expect(isAcceptancePortalView(viewType)).toBe(false);
    },
  );
});
