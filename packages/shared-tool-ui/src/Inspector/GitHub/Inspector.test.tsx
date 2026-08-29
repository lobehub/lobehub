// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { type ComponentType, createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { GitHubInspector } from './Inspector';

describe('GitHubInspector', () => {
  it('uses localized product and API display names when the caller provides them', () => {
    render(
      createElement(GitHubInspector as unknown as ComponentType<Record<string, unknown>>, {
        apiDisplayName: '创建拉取请求',
        apiName: 'create_pull_request',
        args: {},
        identifier: 'github',
        toolDisplayName: 'GitHub 代码托管',
      }),
    );

    expect(screen.getByText('GitHub 代码托管')).toBeTruthy();
    expect(screen.getByText('创建拉取请求')).toBeTruthy();
  });
});
