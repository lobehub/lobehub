import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NameSuggestions from './NameSuggestions';

const translations: Record<string, string> = {
  'agent.welcome.suggestion.items.1.name': 'Lumi',
  'agent.welcome.suggestion.items.1.prompt': '叫你 Lumi 吧，温柔一点。',
  'agent.welcome.suggestion.items.2.name': 'Atlas',
  'agent.welcome.suggestion.items.2.prompt': '叫你 Atlas，稳一点。',
  'agent.welcome.suggestion.items.3.name': 'Momo',
  'agent.welcome.suggestion.items.3.prompt': '先叫你 Momo，轻松一点。',
  'agent.welcome.suggestion.items.4.name': 'Nova',
  'agent.welcome.suggestion.items.4.prompt': '叫你 Nova，想法大胆一点。',
  'agent.welcome.suggestion.items.5.name': 'Milo',
  'agent.welcome.suggestion.items.5.prompt': '叫你 Milo，像个聪明助手。',
  'agent.welcome.suggestion.items.6.name': 'Aster',
  'agent.welcome.suggestion.items.6.prompt': '叫你 Aster，简洁直接。',
  'agent.welcome.suggestion.items.7.name': 'Pixel',
  'agent.welcome.suggestion.items.7.prompt': '叫你 Pixel，偏产品一点。',
  'agent.welcome.suggestion.items.8.name': 'Echo',
  'agent.welcome.suggestion.items.8.prompt': '叫你 Echo，像个耐心搭档。',
  'agent.welcome.suggestion.items.9.name': 'Orbit',
  'agent.welcome.suggestion.items.9.prompt': '叫你 Orbit，长期陪我一起成长。',
  'agent.welcome.suggestion.switch': '换一组',
  'agent.welcome.suggestion.title': '没有灵感？先选一个起点。',
};

const sendMessage = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: (state: { sendMessage: unknown }) => unknown) =>
    selector({
      sendMessage,
    }),
}));

describe('NameSuggestions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sendMessage.mockClear();
  });

  it('sends the selected preset prompt immediately', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<NameSuggestions />);

    fireEvent.click(screen.getByText('Lumi'));

    expect(sendMessage).toHaveBeenCalledWith({ message: '叫你 Lumi 吧，温柔一点。 🌙' });
  });

  it('switches to another preset group when refreshed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<NameSuggestions />);

    expect(screen.getByText('Lumi')).toBeInTheDocument();

    fireEvent.click(screen.getByText('换一组'));

    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.queryByText('Lumi')).not.toBeInTheDocument();
  });
});
