import { describe, expect, it } from 'vitest';

import { filterGoalsByKeyword, normalizeGoalKeyword } from './goalKeywordFilter';

const item = (id: string, title: string, requirement: string | null = null) => ({
  goal: { id, requirement, title } as any,
});

const items = [
  item('g1', '桌宠支持 Workspace 与个人账号', '为桌宠增加 Workspace 支持'),
  item('g2', 'Live2D 素材库扩充', null),
  item('g3', 'Wallpaper Engine 桌面层', 'Render the pet on the DESKTOP layer'),
];

describe('normalizeGoalKeyword', () => {
  it('trims and lower-cases', () => {
    expect(normalizeGoalKeyword('  Live2D ')).toBe('live2d');
  });
});

describe('filterGoalsByKeyword', () => {
  it('keeps the same array for a blank keyword', () => {
    expect(filterGoalsByKeyword(items, '   ')).toBe(items);
  });

  it('matches the title case-insensitively', () => {
    expect(filterGoalsByKeyword(items, 'live2d').map((i) => i.goal.id)).toEqual(['g2']);
  });

  it('matches the requirement too', () => {
    expect(filterGoalsByKeyword(items, 'desktop layer').map((i) => i.goal.id)).toEqual(['g3']);
  });

  it('requires every term to match', () => {
    expect(filterGoalsByKeyword(items, '桌宠 workspace').map((i) => i.goal.id)).toEqual(['g1']);
    expect(filterGoalsByKeyword(items, '桌宠 live2d')).toEqual([]);
  });

  it('treats regex characters literally', () => {
    expect(filterGoalsByKeyword(items, '.*')).toEqual([]);
  });
});
