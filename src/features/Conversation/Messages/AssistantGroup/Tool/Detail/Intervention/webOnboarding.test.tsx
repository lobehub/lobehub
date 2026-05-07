/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar: string }) => <div>{avatar}</div>,
  Flexbox: ({ children }: { children?: ReactNode; [key: string]: unknown }) => (
    <div>{children}</div>
  ),
  Text: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'tool.intervention.onboarding.agentIdentity.description':
            'Approving this change updates the Agent shown in Inbox and in this onboarding conversation.',
          'tool.intervention.onboarding.agentIdentity.title': "I'll update my name and avatar",
          'untitledAgent': 'Untitled Agent',
        }) satisfies Record<string, string>
      )[key] || key,
  }),
}));

describe('web onboarding intervention registry', () => {
  it('renders the custom agent identity approval card for saveUserQuestion', async () => {
    const { WebOnboardingInterventions } =
      await import('@lobechat/builtin-tool-web-onboarding/client');
    const { WebOnboardingApiName } = await import('@lobechat/builtin-tool-web-onboarding');

    const Component = WebOnboardingInterventions[WebOnboardingApiName.saveUserQuestion];

    expect(Component).toBeDefined();
    if (!Component) throw new TypeError('Expected web onboarding intervention to be registered');

    render(<Component args={{ agentEmoji: '🛰️', agentName: 'Atlas' }} messageId="message-1" />);

    expect(screen.getByText("I'll update my name and avatar")).toBeInTheDocument();
    expect(screen.getByText('Atlas')).toBeInTheDocument();
    expect(screen.getByText('🛰️')).toBeInTheDocument();
  });
});
