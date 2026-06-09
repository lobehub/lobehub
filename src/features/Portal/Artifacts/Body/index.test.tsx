import { render, screen } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { ArtifactType } from '@/types/artifact';

import ArtifactsUI from './index';

const mockArtifactState = vi.hoisted(() => ({
  artifactCodeLanguage: undefined as string | undefined,
  artifactContent: '',
  artifactIdentifier: 'snake-game',
  artifactMessageId: 'message-1',
  artifactType: 'text/html' as string | undefined,
  displayMode: 'preview',
  isArtifactTagClosed: false,
  isMessageGenerating: true,
  setState: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
    <div data-testid={style?.overflow === 'auto' ? 'artifact-scroll-container' : undefined}>
      {children}
    </div>
  ),
  Highlighter: ({
    animated,
    children,
    language,
  }: {
    animated?: boolean;
    children: ReactNode;
    language?: string;
  }) => (
    <pre
      data-animated={String(Boolean(animated))}
      data-language={language}
      data-testid="artifact-code"
    >
      {children}
    </pre>
  ),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: Record<PropertyKey, unknown>) => unknown) => {
      return selector({ portalArtifactDisplayMode: mockArtifactState.displayMode });
    },
    {
      setState: mockArtifactState.setState,
    },
  ),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    artifactCode: () => () => mockArtifactState.artifactContent,
    artifactCodeLanguage: () => mockArtifactState.artifactCodeLanguage,
    artifactIdentifier: () => mockArtifactState.artifactIdentifier,
    artifactMessageId: () => mockArtifactState.artifactMessageId,
    artifactType: () => mockArtifactState.artifactType,
    isArtifactTagClosed: () => () => mockArtifactState.isArtifactTagClosed,
  },
  messageStateSelectors: {
    isMessageGenerating: () => () => mockArtifactState.isMessageGenerating,
  },
}));

vi.mock('./Renderer', () => ({
  default: ({ animated, content }: { animated?: boolean; content: string; type?: string }) => (
    <div data-animated={String(Boolean(animated))} data-testid="artifact-preview">
      {content}
    </div>
  ),
}));

describe('ArtifactsUI', () => {
  beforeEach(() => {
    mockArtifactState.artifactCodeLanguage = undefined;
    mockArtifactState.artifactContent = '<!doctype html><html><body><script>';
    mockArtifactState.artifactIdentifier = 'snake-game';
    mockArtifactState.artifactMessageId = 'message-1';
    mockArtifactState.artifactType = 'text/html';
    mockArtifactState.displayMode = ArtifactDisplayMode.Preview;
    mockArtifactState.isArtifactTagClosed = false;
    mockArtifactState.isMessageGenerating = true;
    mockArtifactState.setState.mockClear();
  });

  it('shows scrollable source while an HTML artifact is still streaming', () => {
    render(<ArtifactsUI />);

    expect(screen.getByTestId('artifact-code')).toHaveTextContent('<script>');
    expect(screen.getByTestId('artifact-code')).toHaveAttribute('data-animated', 'true');
    expect(screen.getByTestId('artifact-code')).toHaveAttribute('data-language', 'html');
    expect(screen.getByTestId('artifact-scroll-container')).toBeDefined();
    expect(screen.queryByTestId('artifact-preview')).toBeNull();
    expect(mockArtifactState.setState).not.toHaveBeenCalled();
  });

  it('renders the final preview after the artifact tag closes', () => {
    mockArtifactState.artifactContent = '<!doctype html><html><body>Done</body></html>';
    mockArtifactState.isArtifactTagClosed = true;

    render(<ArtifactsUI />);

    expect(screen.getByTestId('artifact-preview')).toHaveTextContent('Done');
    expect(screen.queryByTestId('artifact-code')).toBeNull();
  });

  it('keeps explicit code artifacts in source mode after they close', () => {
    mockArtifactState.artifactContent = 'console.log("done");';
    mockArtifactState.artifactType = ArtifactType.Code;
    mockArtifactState.isArtifactTagClosed = true;

    render(<ArtifactsUI />);

    expect(screen.getByTestId('artifact-code')).toHaveTextContent('console.log("done");');
    expect(screen.queryByTestId('artifact-preview')).toBeNull();
  });
});
