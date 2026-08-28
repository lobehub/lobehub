/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConfigAction from './ConfigAction';
import GenerationMediaModeSegment from './GenerationMediaModeSegment';

interface SegmentedCapture {
  classNames?: { item?: string; itemLabel?: string };
  onChange?: (value: string) => void;
  options?: Array<{ icon?: ReactNode; label?: ReactNode; value: string }>;
  value?: string;
}

const componentMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  segmented: undefined as SegmentedCapture | undefined,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ActionIcon: ({ title }: { title?: ReactNode }) => (
    <button aria-label={typeof title === 'string' ? title : 'action'} type="button" />
  ),
  Segmented: (props: SegmentedCapture) => {
    componentMocks.segmented = props;
    return (
      <div data-testid="mode-toggle-group">
        {props.options?.map((option) => (
          <span key={option.value}>{option.icon}</span>
        ))}
      </div>
    );
  },
  Select: () => <div data-testid="mode-select" />,
}));

vi.mock('antd-style', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createStaticStyles: () => ({
    heroSelect: 'hero-select',
    heroText: 'hero-text',
    toolbarItem: 'toolbar-item',
    toolbarLabel: 'toolbar-label',
  }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => componentMocks.navigate,
}));

vi.mock('@/features/ChatInput/ActionBar/components/ActionDropdown', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/ChatInput/ActionBar/components/ActionPopover', () => ({
  default: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: <T,>(selector: (state: { isMobile: boolean }) => T) =>
    selector({ isMobile: false }),
}));

describe('GenerationMediaModeSegment', () => {
  it('uses an icon-only toggle group in the composer toolbar', () => {
    render(<GenerationMediaModeSegment mode="image" />);

    const toggleGroup = screen.getByTestId('mode-toggle-group');
    expect(toggleGroup).toBeInTheDocument();
    expect(screen.queryByTestId('mode-select')).not.toBeInTheDocument();
    expect(toggleGroup.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.queryByText('tab.image')).not.toBeInTheDocument();
    expect(screen.queryByText('tab.video')).not.toBeInTheDocument();
    expect(componentMocks.segmented?.options?.map((option) => option.label)).toEqual([
      'tab.image',
      'tab.video',
    ]);
    expect(componentMocks.segmented?.classNames).toEqual({
      item: 'toolbar-item',
      itemLabel: 'toolbar-label',
    });

    act(() => componentMocks.segmented?.onChange?.('video'));
    expect(componentMocks.navigate).toHaveBeenCalledWith('/video');
  });

  it('keeps the labeled select in the hero title', () => {
    render(<GenerationMediaModeSegment layout="hero" mode="image" />);

    expect(screen.getByTestId('mode-select')).toBeInTheDocument();
    expect(screen.queryByTestId('mode-toggle-group')).not.toBeInTheDocument();
  });
});

describe('generation toolbar actions', () => {
  it('renders without a ChatInputProvider', () => {
    render(<ConfigAction content={<span>config-content</span>} title="config-title" />);

    expect(screen.getByRole('button', { name: 'config-title' })).toBeInTheDocument();
    expect(screen.getByText('config-content')).toBeInTheDocument();
  });
});
