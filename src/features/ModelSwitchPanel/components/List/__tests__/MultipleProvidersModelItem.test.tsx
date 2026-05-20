/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MultipleProvidersModelItem } from '../MultipleProvidersModelItem';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuGroupLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  DropdownMenuItemIcon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuItemLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuPopup: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuPositioner: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubmenuRoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubmenuTrigger: ({
    children,
    className,
    onClick,
    style,
  }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} style={style} onClick={onClick}>
      {children}
    </div>
  ),
  Flexbox: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  menuSharedStyles: { item: 'item' },
}));

vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: ({ displayName }: { displayName: string }) => <div>{displayName}</div>,
  ProviderItemRender: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock('../../ModelDetailPanel', () => ({
  default: ({ model, provider }: { model: string; provider: string }) => (
    <div data-testid="model-detail-panel">
      {provider}/{model}
    </div>
  ),
}));

describe('MultipleProvidersModelItem', () => {
  it('renders model detail panel even when info tags are hidden', () => {
    render(
      <MultipleProvidersModelItem
        activeKey="lobehub/gpt-5.4"
        newLabel="new"
        showInfoTag={false}
        data={{
          displayName: 'GPT-5.4',
          model: {
            abilities: {},
            displayName: 'GPT-5.4',
            id: 'gpt-5.4',
          } as any,
          providers: [
            { id: 'lobehub', name: 'LobeHub' },
            { id: 'openai', name: 'OpenAI' },
          ],
        }}
        onClose={vi.fn()}
        onModelChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('model-detail-panel')).toHaveTextContent('lobehub/gpt-5.4');
    expect(screen.getByText('ModelSwitchPanel.useModelFrom')).toBeInTheDocument();
  });
});
