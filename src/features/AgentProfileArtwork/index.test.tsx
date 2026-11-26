import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentProfileArtwork } from './index';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/components/EmojiPicker', () => {
  const MockEmojiPicker = () => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return <div data-testid="picker" />;
  };
  return { default: MockEmojiPicker };
});

const props = {
  agentId: 'agent',
  canEdit: true,
  locale: 'en-US',
  onAvatarChange: vi.fn(),
  onBackgroundChange: vi.fn(),
};

describe('AgentProfileArtwork', () => {
  beforeEach(() => {
    mounts.count = 0;
  });

  // A remount closes the popup, so picking a second shape or color would need reopening it.
  it('keeps the avatar picker mounted while a character is picked', () => {
    const { rerender } = render(<AgentProfileArtwork {...props} avatar="agent-avatar:cat:green" />);

    rerender(<AgentProfileArtwork {...props} avatar="agent-avatar:rocket:green" />);
    rerender(<AgentProfileArtwork {...props} avatar="agent-avatar:rocket:cyan" />);

    expect(mounts.count).toBe(1);
  });
});
