import { describe, expect, it } from 'vitest';

import { buildLinearRenderModel } from './utils';

describe('buildLinearRenderModel', () => {
  it('summarizes Linear update issue input and result without exposing raw JSON first', () => {
    const model = buildLinearRenderModel({
      apiName: 'save_issue',
      args: {
        id: 'LOBE-10205',
        links: [
          {
            title: 'PR #15766: refactor(chat): unify agent run lifecycle',
            url: 'https://github.com/lobehub/lobehub/pull/15766',
          },
        ],
        state: 'In Review',
      },
      content: JSON.stringify({
        description: '## 背景\n\n统一三种客户端 Agent Runtime 的 run 生命周期 hooks。',
        id: 'LOBE-10205',
        links: [
          {
            title: 'PR #15766: refactor(chat): unify agent run lifecycle',
            url: 'https://github.com/lobehub/lobehub/pull/15766',
          },
        ],
        state: { name: 'In Review' },
        title: '统一三种客户端 Agent Runtime 的 run 生命周期 hooks',
        url: 'https://linear.app/lobehub/issue/LOBE-10205',
      }),
    });

    expect(model.actionLabel).toBe('Save issue');
    expect(model.requestFields).toEqual([
      { key: 'id', label: 'ID', value: 'LOBE-10205' },
      { key: 'state', label: 'State', value: 'In Review' },
    ]);
    expect(model.requestLinks).toHaveLength(1);
    expect(model.resultEntities).toHaveLength(1);
    expect(model.resultEntities[0]).toMatchObject({
      description: '## 背景\n\n统一三种客户端 Agent Runtime 的 run 生命周期 hooks。',
      id: 'LOBE-10205',
      state: 'In Review',
      title: '统一三种客户端 Agent Runtime 的 run 生命周期 hooks',
      url: 'https://linear.app/lobehub/issue/LOBE-10205',
    });
    expect(model.rawResultJson).toBeUndefined();
  });

  it('normalizes Codex Apps entity-prefixed ids in request fields', () => {
    const model = buildLinearRenderModel({
      apiName: 'get_issue',
      args: { id: 'issue:LOBE-10205' },
      content: '{"title":"Resume error on topic switch"}',
    });

    expect(model.requestFields).toContainEqual({ key: 'id', label: 'ID', value: 'LOBE-10205' });
    expect(model.resultEntities[0]).toMatchObject({ title: 'Resume error on topic switch' });
  });

  it('keeps non-JSON result text as a readable fallback', () => {
    const model = buildLinearRenderModel({
      apiName: 'search',
      args: { query: 'agent runtime' },
      content: 'No matching Linear issues found.',
    });

    expect(model.resultText).toBe('No matching Linear issues found.');
  });
});
