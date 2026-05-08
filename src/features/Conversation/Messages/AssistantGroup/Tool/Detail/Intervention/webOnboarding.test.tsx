/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
          'tool.intervention.onboarding.agentIdentity.title': "I'll update my name and avatar",
          'tool.intervention.onboarding.agentIdentity.titleAvatarOnly': "I'll update my avatar",
          'tool.intervention.onboarding.agentIdentity.titleNameOnly': "I'll update my name",
          'untitledAgent': 'Untitled Agent',
        }) satisfies Record<string, string>
      )[key] || key,
  }),
}));

describe('web onboarding intervention registry', () => {
  let Component: ReturnType<typeof Object> | undefined;

  beforeEach(async () => {
    const { WebOnboardingInterventions } =
      await import('@lobechat/builtin-tool-web-onboarding/client');
    const { WebOnboardingApiName } = await import('@lobechat/builtin-tool-web-onboarding');
    Component = WebOnboardingInterventions[WebOnboardingApiName.saveUserQuestion];
    expect(Component).toBeDefined();
  });

  it('uses the combined title when both agentName and agentEmoji are pending', () => {
    if (!Component) throw new TypeError('Expected web onboarding intervention to be registered');

    render(<Component args={{ agentEmoji: '🛰️', agentName: 'Atlas' }} messageId="message-1" />);

    expect(screen.getByText("I'll update my name and avatar")).toBeInTheDocument();
    expect(screen.getByText('Atlas')).toBeInTheDocument();
    expect(screen.getByText('🛰️')).toBeInTheDocument();
  });

  it('uses the name-only title when only agentName is pending', () => {
    if (!Component) throw new TypeError('Expected web onboarding intervention to be registered');

    render(<Component args={{ agentName: 'Atlas' }} messageId="message-2" />);

    expect(screen.getByText("I'll update my name")).toBeInTheDocument();
    expect(screen.queryByText("I'll update my name and avatar")).not.toBeInTheDocument();
  });

  it('uses the avatar-only title when only agentEmoji is pending', () => {
    if (!Component) throw new TypeError('Expected web onboarding intervention to be registered');

    render(<Component args={{ agentEmoji: '🛰️' }} messageId="message-3" />);

    expect(screen.getByText("I'll update my avatar")).toBeInTheDocument();
    expect(screen.queryByText("I'll update my name and avatar")).not.toBeInTheDocument();
  });
});
