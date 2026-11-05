import * as Icons from '@lobehub/ui/icons';
import { describe, expect, it } from 'vitest';

import { getPlatformIcon } from './const';

describe('getPlatformIcon', () => {
  it('resolves WeCom from @lobehub/ui/icons by id and by display name', () => {
    expect(getPlatformIcon('wecom')).toBe(Icons.WeCom);
    expect(getPlatformIcon('WeCom')).toBe(Icons.WeCom);
    expect('Color' in Icons.WeCom).toBe(true);
  });

  it('resolves DingTalk by platform id and by display name', () => {
    expect(Icons.DingTalk).toBeDefined();
    expect(getPlatformIcon('dingtalk')).toBe(Icons.DingTalk);
    expect(getPlatformIcon('DingTalk')).toBe(Icons.DingTalk);
  });

  it('keeps resolving the other platforms from @lobehub/ui/icons', () => {
    expect(getPlatformIcon('wechat')).toBe(Icons.WeChat);
    expect(getPlatformIcon('feishu')).toBe(Icons.Lark);
    expect(getPlatformIcon('qq')).toBe(Icons.QQ);
    expect(getPlatformIcon('Discord')).toBe(Icons.Discord);
    expect(getPlatformIcon('unknown-platform')).toBeUndefined();
  });
});
