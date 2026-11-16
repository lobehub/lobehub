import * as Icons from '@lobehub/ui/icons';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getPlatformIcon } from './const';
import { WeComIcon } from './WeComIcon';

describe('getPlatformIcon', () => {
  it('resolves WeCom to the local icon with the multi-color petals, by id and by display name', () => {
    expect(getPlatformIcon('wecom')).toBe(WeComIcon);
    expect(getPlatformIcon('WeCom')).toBe(WeComIcon);
    expect(WeComIcon.Color).not.toBe(Icons.WeCom.Color);
    expect(WeComIcon.colorPrimary).toBe(Icons.WeCom.colorPrimary);
  });

  it('colors the WeCom petals green, blue, orange and yellow next to the blue bubble', () => {
    const svg = renderToStaticMarkup(createElement(WeComIcon.Color, { size: 24 }));
    const fills = [...svg.matchAll(/<path[^>]*fill="([^"]+)"/g)].map((match) => match[1]);

    expect(fills).toEqual(['#0082EF', '#2DBC00', '#0082EF', '#FB6500', '#FFCC00']);
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
