import { describe, expect, it } from 'vitest';

import { isStatusHidden } from './statusHidden';

describe('isStatusHidden', () => {
  // The thread page showed the device and cloud icons above its own header actions: two toolbars
  // stacked in the same corner.
  it('hides the status icons on a Channel thread page', () => {
    expect(isStatusHidden('/lobehub/project/prj_1/channels/chn_1/threads/cht_1')).toBe(true);
    expect(isStatusHidden('/channels/chn_1/threads/cht_1')).toBe(true);
  });

  it('keeps them on the Channel itself and every other page', () => {
    expect(isStatusHidden('/lobehub/channels/chn_1')).toBe(false);
    expect(isStatusHidden('/channels/chn_1/settings')).toBe(false);
    expect(isStatusHidden('/agent/agt_1')).toBe(false);
  });
});
