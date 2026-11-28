import type { ChannelMessageSurface } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { readActionMessage } from './actionMessage';

const surface: ChannelMessageSurface = {
  catalogId: 'basic',
  fallback: '',
  operations: [
    {
      updateComponents: {
        components: [
          { component: 'TextField', id: 'title', label: '一句话摘要', value: { path: '/title' } },
          {
            component: 'ChoicePicker',
            id: 'type',
            label: '问题类型',
            options: [{ label: '性能', value: 'perf' }],
            value: { path: '/type' },
          },
          {
            component: 'CheckBox',
            id: 'repro',
            label: '我已在本地复现',
            value: { path: '/repro' },
          },
          {
            action: {
              event: {
                context: {
                  repro: { path: '/repro' },
                  title: { path: '/title' },
                  type: { path: '/type' },
                },
                name: 'submit_problem',
              },
            },
            component: 'Button',
            id: 'submit',
          },
        ],
      },
    },
  ],
  surfaceId: 'problem-report-form',
  title: '问题上报',
  version: 'v0.9',
};

const content =
  '「问题上报」 · submit_problem\n<a2ui_action>{"context":{"title":"","type":["perf"],"repro":false,"impact":572},"name":"submit_problem","surfaceId":"problem-report-form"}</a2ui_action>';

describe('readActionMessage', () => {
  it('reads each value under its field label and options under their labels', () => {
    expect(readActionMessage(content, [surface])).toMatchObject({
      fields: [
        { key: 'title', label: '一句话摘要', value: '' },
        { key: 'type', label: '问题类型', value: ['性能'] },
        { key: 'repro', label: '我已在本地复现', value: false },
        { key: 'impact', label: 'impact', value: 572 },
      ],
      title: '问题上报',
    });
  });

  it('falls back to the keys and the leading title without the card', () => {
    const read = readActionMessage(content, undefined);
    expect(read?.title).toBe('问题上报');
    expect(read?.fields.map((field) => field.label)).toEqual(['title', 'type', 'repro', 'impact']);
  });

  it('ignores plain text', () => {
    expect(readActionMessage('hello', undefined)).toBeUndefined();
  });
});
