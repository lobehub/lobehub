import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NameSuggestions from './NameSuggestions';

const translations: Record<string, string> = {
  'agent.welcome.suggestion.switch': '换一组',
  'agent.welcome.suggestion.title': '一下子没灵感？先挑一个吧',
};

const updateInputMessage = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: (state: { updateInputMessage: unknown }) => unknown) =>
    selector({
      updateInputMessage,
    }),
}));

describe('NameSuggestions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    updateInputMessage.mockClear();
  });

  it('fills the chat input with the selected preset prompt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<NameSuggestions />);

    fireEvent.click(screen.getByText('Lumi'));

    expect(updateInputMessage).toHaveBeenCalledWith(
      'Let’s call you Lumi first. Warm, thoughtful, and a little dreamy. 🌙',
    );
  });

  it('switches to a different set of names when refreshed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<NameSuggestions />);

    expect(screen.getByText('Lumi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('换一组'));

    expect(screen.queryByText('Lumi')).not.toBeInTheDocument();
    expect(screen.getByText('Nova')).toBeInTheDocument();
  });
});
