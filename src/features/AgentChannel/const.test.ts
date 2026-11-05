import * as Icons from '@lobehub/ui/icons';
import { describe, expect, it } from 'vitest';

import { getPlatformIcon } from './const';

describe('getPlatformIcon', () => {
  it('resolves DingTalk by platform id and by display name', () => {
    expect(Icons.DingTalk).toBeDefined();
    expect(getPlatformIcon('dingtalk')).toBe(Icons.DingTalk);
    expect(getPlatformIcon('DingTalk')).toBe(Icons.DingTalk);
  });

  it('keeps resolving the existing platforms', () => {
    expect(getPlatformIcon('feishu')).toBe(Icons.Lark);
    expect(getPlatformIcon('qq')).toBe(Icons.QQ);
    expect(getPlatformIcon('unknown')).toBeUndefined();
  });
});
