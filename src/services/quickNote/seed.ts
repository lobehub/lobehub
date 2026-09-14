import { nanoid } from '@lobechat/utils';

import type { QuickNoteItem } from './type';

export const MOCK_LOCATION = 'Houston, TX';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const createSeedNotes = (): QuickNoteItem[] => {
  const now = Date.now();

  return [
    {
      collection: 'Product watch',
      content:
        '大疆 Pocket 4 Pro 出了，云台画质据说提升明显，回头对比一下 Insta360 的新品再决定换不换。',
      createdAt: now - 40 * MINUTE,
      id: nanoid(),
      location: MOCK_LOCATION,
      tags: ['产品', 'DJI'],
      updatedAt: now - 40 * MINUTE,
    },
    {
      annotation: {
        content:
          '这条随手记围绕「冒险家艾略特的千年奇谭」展开。\n\n概述：一款 HD-2D 风格的游戏引起了兴趣，值得作为灵感素材留档。\n\n可能的后续线索：\n- 看一下实机演示和发售时间\n- 归档到灵感集合，方便之后翻阅',
        divedAt: now - 80 * MINUTE,
      },
      collection: 'Personal',
      content: '[截图] 冒险家艾略特的千年奇谭 这个 HD-2D 感觉有点意思，先记一下。',
      createdAt: now - 90 * MINUTE,
      id: nanoid(),
      location: MOCK_LOCATION,
      tags: ['灵感', '游戏'],
      updatedAt: now - 85 * MINUTE,
    },
    {
      collection: 'Tasks & bugs',
      content:
        '[截图] LobeHub brief 界面 leave comment 会被吞掉。\n\n[截图] iMessage channel 发出去之后状态不对，也先记一下。',
      createdAt: now - 2 * HOUR,
      id: nanoid(),
      location: MOCK_LOCATION,
      tags: ['Bug', 'task'],
      updatedAt: now - 2 * HOUR,
    },
    {
      collection: 'Research',
      content:
        'Agent 记忆的产品调研：Mem0 / Zep / LobeHub memory 的差异到底在哪，周末整理一篇对比。',
      createdAt: now - 4 * HOUR,
      id: nanoid(),
      location: MOCK_LOCATION,
      tags: ['Research'],
      updatedAt: now - 4 * HOUR,
    },
    {
      content: '我现在口语有点差啊，得想办法每天开口说十分钟。',
      createdAt: now - 5 * HOUR,
      id: nanoid(),
      location: MOCK_LOCATION,
      tags: ['weak signal', '表达'],
      updatedAt: now - 5 * HOUR,
    },
  ];
};
