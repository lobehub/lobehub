'use client';

import { defineFixtures, variants } from './_helpers';

const goalArgs = {
  criteria: [
    {
      instruction: '确认移动端首页最大内容绘制时间低于 2 秒。',
      onFail: 'auto_repair',
      required: true,
      title: '移动端 LCP < 2s',
      verifierType: 'agent',
    },
    {
      instruction: '确认首页已经切换到新的品牌视觉和文案。',
      onFail: 'auto_repair',
      required: true,
      title: '新版品牌首页已上线',
      verifierType: 'agent',
    },
    {
      instruction: '检查桌面端与移动端关键入口均可访问，且不存在阻断错误。',
      onFail: 'auto_repair',
      required: true,
      title: '关键路径无回归',
      verifierType: 'agent',
    },
  ],
  instruction:
    '完成官网首页品牌改版并上线；以移动端 LCP 小于 2 秒为核心指标，同时验证关键访问路径。',
  maxIterations: 3,
  name: '官网首页改版并上线，LCP < 2s',
};

export default defineFixtures({
  identifier: 'lobe-goal',
  fixtures: {
    createGoal: variants([
      {
        args: goalArgs,
        description: '完整的可编辑目标计划，用于 Intervention 状态。',
        label: '计划确认',
      },
      {
        args: goalArgs,
        description: '用户确认计划后，任务进入第一轮执行。',
        label: '第 1 轮运行中',
        pluginState: {
          identifier: 'T-482',
          name: goalArgs.name,
          operationId: 'goal-demo-operation',
          startedAt: new Date(Date.now() - (39 * 60 + 12) * 1000).toISOString(),
          success: true,
          taskId: 'task-goal-demo',
          topicId: 'topic-goal-demo',
        },
      },
    ]),
  },
});
