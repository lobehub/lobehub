import { describe, expect, it } from 'vitest';

import enUS from '@/../locales/en-US/editor.json';
import zhCN from '@/../locales/zh-CN/editor.json';
import zhTW from '@/../locales/zh-TW/editor.json';
import defaultEditor from '@/../packages/locales/src/default/editor';

const collaborationAgentKeys = [
  'collaboration.aiAgent',
  'collaboration.aiAgentAwaitingReview',
  'collaboration.aiAgentConnecting',
  'collaboration.aiAgentSyncing',
  'collaboration.aiAgentThinking',
  'collaboration.aiAgentWriting',
] as const;

describe('Page editor locale copy', () => {
  it('ships a translated direct-apply hint instead of the removed review hint', () => {
    expect(enUS['copilot.rewrite.applyHint']).toContain('directly');
    expect(zhCN['copilot.rewrite.applyHint']).toContain('直接');
    expect(enUS['copilot.rewrite.activeCount']).toContain('{{count}}/{{limit}}');
    expect(zhCN['copilot.rewrite.activeCount']).toContain('活跃 Agent');
    expect(enUS['copilot.rewrite.activeLimit']).toContain('{{limit}}');
    expect(zhCN['copilot.rewrite.activeLimit']).toContain('最多同时运行');
    expect(enUS['copilot.rewrite.appliedDirectly']).toContain('directly');
    expect(zhCN['copilot.rewrite.appliedDirectly']).toContain('直接');
    expect(enUS['copilot.rewrite.originalSelection']).toContain('Original selection');
    expect(zhCN['copilot.rewrite.originalSelection']).toContain('原选区');
    expect(enUS['copilot.rewrite.selectionStatus']).toContain('characters');
    expect(zhCN['copilot.rewrite.selectionStatus']).toContain('已选中');
    expect(enUS['copilot.rewrite.overlapError']).toContain('overlaps');
    expect(zhCN['copilot.rewrite.overlapError']).toContain('重叠');
    expect(enUS).not.toHaveProperty('copilot.rewrite.reviewHint');
    expect(zhCN).not.toHaveProperty('copilot.rewrite.reviewHint');
  });

  it('ships AI collaboration cursor labels in every Page editor locale', () => {
    for (const translations of [defaultEditor, enUS, zhCN, zhTW]) {
      for (const key of collaborationAgentKeys) {
        expect(translations[key]).toBeTruthy();
        expect(translations[key]).not.toBe(key);
      }
    }

    expect(zhCN['collaboration.aiAgentThinking']).toBe('AI Agent（思考中…）');
    expect(zhCN['collaboration.aiAgentWriting']).toBe('AI Agent（正在输入…）');
  });
});
