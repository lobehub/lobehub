// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { type ComponentType, createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { LinearInspector } from './Inspector';

describe('LinearInspector', () => {
  it('uses localized product and API display names when the caller provides them', () => {
    render(
      createElement(LinearInspector as unknown as ComponentType<Record<string, unknown>>, {
        apiDisplayName: '删除附件',
        apiName: 'delete_attachment',
        args: {},
        identifier: 'linear',
        toolDisplayName: 'Linear 项目管理',
      }),
    );

    expect(screen.getByText('Linear 项目管理')).toBeTruthy();
    expect(screen.getByText('删除附件')).toBeTruthy();
  });
});
