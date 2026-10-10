import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import CreateGenerationPage from './CreateGenerationPage';

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

const { dragZoneProps } = vi.hoisted(() => ({ dragZoneProps: [] as any[] }));

vi.mock('@/components/DragUploadZone', () => ({
  default: ({ children, ...props }: any) => {
    dragZoneProps.push(props);
    return <div data-testid="drag-upload-zone">{children}</div>;
  },
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

  it('opts the drop zone into window paste upload when uploads are wired', () => {
    const onUploadFiles = vi.fn();
    render(
      <MemoryRouter initialEntries={['/image']}>
        <CreateGenerationPage
          PromptInput={PromptInput}
          Workspace={Workspace}
          dragDisabled={false}
          path="/image"
          onUploadFiles={onUploadFiles}
        />
      </MemoryRouter>,
    );

    const zone = dragZoneProps.at(-1);
    expect(zone.enablePasteUpload).toBe(true);
    expect(zone.disabled).toBe(false);
    expect(zone.onUploadFiles).toBe(onUploadFiles);
  });

  it('propagates dragDisabled to the drop zone', () => {
    render(
      <MemoryRouter initialEntries={['/video']}>
        <CreateGenerationPage
          dragDisabled
          PromptInput={PromptInput}
          Workspace={Workspace}
          path="/video"
          onUploadFiles={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(dragZoneProps.at(-1).disabled).toBe(true);
  });
});
