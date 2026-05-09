/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar: string }) => <div>{avatar}</div>,
  EmojiPicker: ({ onChange, value }: { onChange?: (next: string) => void; value?: string }) => (
    <button data-testid="emoji-picker" type="button" onClick={() => onChange?.('🪶')}>
      {value || ''}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode; [key: string]: unknown }) => (
    <div>{children}</div>
  ),
  Text: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) =>
      (
        ({
          'tool.intervention.onboarding.agentIdentity.editHint':
            'Not what you wanted? Click the avatar or name to edit directly.',
          'tool.intervention.onboarding.agentIdentity.namePlaceholder': 'Agent name',
          'tool.intervention.onboarding.agentIdentity.title': "I'll update my name and avatar",
          'tool.intervention.onboarding.agentIdentity.titleAvatarOnly': "I'll update my avatar",
          'tool.intervention.onboarding.agentIdentity.titleNameOnly': "I'll update my name",
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
    expect(screen.getByDisplayValue('Atlas')).toBeInTheDocument();
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

  it('flips title to combined when user types a name into an emoji-only proposal', () => {
    if (!Component) throw new TypeError('Expected web onboarding intervention to be registered');

    render(<Component args={{ agentEmoji: '🛰️' }} messageId="message-4" />);

    expect(screen.getByText("I'll update my avatar")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Agent name'), { target: { value: 'Atlas' } });
    expect(screen.getByText("I'll update my name and avatar")).toBeInTheDocument();
  });

  it('flushes edited name and emoji to onArgsChange when approve is requested', async () => {
    if (!Component) throw new TypeError('Expected web onboarding intervention to be registered');

    const onArgsChange = vi.fn();
    let beforeApproveCallback: (() => Promise<void>) | undefined;
    const registerBeforeApprove = (_id: string, callback: () => Promise<void>) => {
      beforeApproveCallback = callback;
      return () => {
        beforeApproveCallback = undefined;
      };
    };

    render(
      <Component
        args={{ agentEmoji: '🛰️', agentName: 'Atlas' }}
        messageId="message-5"
        registerBeforeApprove={registerBeforeApprove}
        onArgsChange={onArgsChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Agent name'), {
      target: { value: 'Aurora' },
    });
    fireEvent.click(screen.getByTestId('emoji-picker'));

    expect(beforeApproveCallback).toBeTypeOf('function');
    await beforeApproveCallback!();

    expect(onArgsChange).toHaveBeenCalledWith({
      agentEmoji: '🪶',
      agentName: 'Aurora',
    });
  });
});
