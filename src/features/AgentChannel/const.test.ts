import * as Icons from '@lobehub/ui/icons';
import { describe, expect, it } from 'vitest';

import { getPlatformIcon } from './const';
import { WECOM_COLOR_PRIMARY, WeComIcon } from './WeComIcon';

describe('getPlatformIcon', () => {
  it('resolves WeCom by id and by display name, with a brand-color variant', () => {
    expect(getPlatformIcon('wecom')).toBe(WeComIcon);
    expect(getPlatformIcon('WeCom')).toBe(WeComIcon);
    expect('Color' in WeComIcon).toBe(true);
    expect(WeComIcon.colorPrimary).toBe(WECOM_COLOR_PRIMARY);
  });

  it('keeps resolving the other platforms from @lobehub/ui/icons', () => {
    expect(getPlatformIcon('wechat')).toBe(Icons.WeChat);
    expect(getPlatformIcon('feishu')).toBe(Icons.Lark);
    expect(getPlatformIcon('Discord')).toBe(Icons.Discord);
    expect(getPlatformIcon('unknown-platform')).toBeUndefined();
  });
});
