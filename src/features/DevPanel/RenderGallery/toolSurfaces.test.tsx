import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolInspectorSlot } from './toolSurfaces';
import type { ApiEntry } from './useDevtoolsEntries';

describe('ToolInspectorSlot', () => {
  it('passes localized tool and API labels to the registered inspector', () => {
    const api = {
      apiDisplayName: '删除附件',
      apiName: 'delete_attachment',
      fixture: { variants: [] },
      identifier: 'linear',
      inspector: ((props: { apiDisplayName?: string; toolDisplayName?: string }) => (
        <span>{`${props.toolDisplayName}｜${props.apiDisplayName}`}</span>
      )) as ApiEntry['inspector'],
      toolDisplayName: 'Linear 项目管理',
    } as ApiEntry;

    render(
      <ToolInspectorSlot
        api={api}
        variant={{ args: {}, id: 'default', label: '默认' }}
        derived={{
          args: {},
          content: '',
          isArgumentsStreaming: false,
          isLoading: false,
          partialArgs: undefined,
          pluginError: undefined,
          pluginState: undefined,
        }}
      />,
    );

    expect(screen.getByText('Linear 项目管理｜删除附件')).toBeInTheDocument();
  });
});
