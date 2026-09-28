import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { getFloatingCollisionPadding, setFloatingCollisionPadding } from '@lobehub/ui/base-ui';
import { afterEach, describe, expect, it } from 'vitest';

import { reserveTitleBarForFloatingLayers } from './floatingLayers';

afterEach(() => setFloatingCollisionPadding(undefined));

describe('reserveTitleBarForFloatingLayers', () => {
  it('keeps every base-ui floating layer below the desktop title bar', () => {
    reserveTitleBarForFloatingLayers();

    expect(getFloatingCollisionPadding()).toMatchObject({ top: TITLE_BAR_HEIGHT });
  });
});
