import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { formatDocument } from '../AgentDocumentInjector';

const alwaysDoc = (content: string, maxTokens?: number) => ({
  content,
  filename: 'checklist.md',
  loadRules: { maxTokens },
  policyLoad: 'always' as const,
});

describe('formatDocument maxTokens', () => {
  // T-14044: the cap counted whitespace-separated words, so a Chinese document
  // (one "word" per paragraph) was injected whole under maxTokens: 900.
  it('caps Chinese content that has no spaces', () => {
    const content = '发布前确认数据库迁移已在预发环境执行完成，并检查回滚脚本。'.repeat(200);

    const formatted = formatDocument(alwaysDoc(content, 900), {});

    expect(formatted.endsWith('\n...[truncated]')).toBe(true);
    const kept = formatted.slice(0, -'\n...[truncated]'.length);
    expect(content.startsWith(kept)).toBe(true);
    expect(estimateTokenCount(kept)).toBeLessThanOrEqual(900);
    expect(kept.length).toBeLessThan(content.length);
  });

  it('caps English content by estimated tokens', () => {
    const content = 'Confirm the migration ran on staging and check the rollback. '.repeat(300);

    const formatted = formatDocument(alwaysDoc(content, 900), {});
    const kept = formatted.slice(0, -'\n...[truncated]'.length);

    expect(formatted.endsWith('\n...[truncated]')).toBe(true);
    expect(estimateTokenCount(kept)).toBeLessThanOrEqual(900);
    expect(estimateTokenCount(kept)).toBeGreaterThan(800);
  });

  it('keeps content that already fits, and ignores a missing or zero cap', () => {
    const content = '短文档，不需要截断。';

    expect(formatDocument(alwaysDoc(content, 900), {})).toBe(content);
    expect(formatDocument(alwaysDoc(content.repeat(500), 0), {})).toBe(content.repeat(500));
    expect(formatDocument(alwaysDoc(content.repeat(500)), {})).toBe(content.repeat(500));
  });
});
