import { UIChatMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { AssistantMessageExtra } from './index';

vi.mock('zustand/traditional');

// Mock TTS and Translate components
vi.mock('@/features/Conversation/components/Extras/TTS', () => ({
  default: vi.fn(() => <div>TTS Component</div>),
}));
vi.mock('@/features/Conversation/components/Extras/Translate', () => ({
  default: vi.fn(() => <div>Translate Component</div>),
}));
vi.mock('@/features/Conversation/components/Extras/Usage', () => ({
  default: vi.fn(() => <div>Usage Component</div>),
}));

// Mock store
vi.mock('@/store/chat', () => ({
  useChatStore: vi.fn(),
}));

const mockData: UIChatMessage = {
  content: 'test-content',
  createdAt: 0,
  id: 'abc',
  meta: { avatar: '', backgroundColor: '', description: '', tags: [], title: '' },
  role: 'assistant',
  updatedAt: 0,
};

describe('AssistantMessageExtra', () => {
  beforeEach(() => {
    // Mock useChatStore to return false for loading state
    (useChatStore as unknown as Mock).mockReturnValue(false);
  });

  it('should not render content if extra is undefined', async () => {
    render(<AssistantMessageExtra {...mockData} />);
    expect(screen.queryByText('Usage Component')).toBeNull();
    expect(screen.queryByText('TTS Component')).toBeNull();
    expect(screen.queryByText('Translate Component')).toBeNull();
  });

  it('should not render content if extra is defined but does not contain fromModel, tts, or translate', async () => {
    render(<AssistantMessageExtra {...mockData} extra={{}} />);
    expect(screen.queryByText('Usage Component')).toBeNull();
    expect(screen.queryByText('TTS Component')).toBeNull();
    expect(screen.queryByText('Translate Component')).toBeNull();
  });

  it('should render Usage component if extra.fromModel exists', async () => {
    render(
      <AssistantMessageExtra
        {...mockData}
        extra={{ fromModel: 'gpt-4', fromProvider: 'openai' }}
      />,
    );

    expect(screen.getByText('Usage Component')).toBeInTheDocument();
  });

  it('should render TTS component if extra.tts exists', async () => {
    render(<AssistantMessageExtra {...mockData} extra={{ tts: {} }} />);

    expect(screen.getByText('TTS Component')).toBeInTheDocument();
  });

  it('should render Translate component if extra.translate exists', async () => {
    render(<AssistantMessageExtra {...mockData} extra={{ translate: { to: 'abc' } }} />);
    expect(screen.getByText('Translate Component')).toBeInTheDocument();
  });

  it('should render both TTS and Translate components when both exist in extra', async () => {
    render(<AssistantMessageExtra {...mockData} extra={{ translate: { to: 'abc' }, tts: {} }} />);
    expect(screen.getByText('TTS Component')).toBeInTheDocument();
    expect(screen.getByText('Translate Component')).toBeInTheDocument();
  });

  it('should pass loading state to TTS and Translate components', async () => {
    (useChatStore as unknown as Mock).mockReturnValue(true);

    render(<AssistantMessageExtra {...mockData} extra={{ translate: { to: 'abc' }, tts: {} }} />);
    expect(screen.getByText('TTS Component')).toBeInTheDocument();
    expect(screen.getByText('Translate Component')).toBeInTheDocument();
  });
});
