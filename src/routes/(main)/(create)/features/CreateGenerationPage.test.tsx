import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import CreateGenerationPage from './CreateGenerationPage';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: {
    div: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock('@/features/NavHeader', () => ({
  default: () => <div data-testid="nav-header" />,
}));

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/WideScreenContainer/WideScreenButton', () => ({
  default: () => <button type="button">wide</button>,
}));

vi.mock('@/hooks/useQueryParam', () => ({
  useQueryState: () => [null],
}));

const PromptInput = () => <div data-testid="prompt-input" />;
const Workspace = () => <div data-testid="generation-workspace" />;

const renderPage = (path: string, entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <CreateGenerationPage PromptInput={PromptInput} Workspace={Workspace} path={path} />
    </MemoryRouter>,
  );

describe('CreateGenerationPage', () => {
  it.each([
    ['/image', '/image'],
    ['/video', '/video'],
  ])('renders %s on the personal generation path', (path, entry) => {
    renderPage(path, entry);

    expect(screen.getByTestId('prompt-input')).toBeInTheDocument();
  });

  it.each([
    ['/image', '/hug/image'],
    ['/video', '/hug/video'],
  ])('renders %s on the workspace generation path', (path, entry) => {
    renderPage(path, entry);

    expect(screen.getByTestId('prompt-input')).toBeInTheDocument();
  });
});
