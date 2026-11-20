import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeCodeEntrypointSetting } from './ClaudeCodeEntrypointSetting';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      key === 'heterogeneousStatus.entrypoint.desc' ? `Launched by ${options?.name}` : key,
  }),
}));

const SWITCH = 'heterogeneousStatus.entrypoint.switch';
const RISK = 'heterogeneousStatus.entrypoint.risk';

describe('ClaudeCodeEntrypointSetting', () => {
  it('is off by default, warns about the risk and writes lobehub when turned on', async () => {
    const onEnvChange = vi.fn();
    render(
      <ClaudeCodeEntrypointSetting
        env={{ ANTHROPIC_BASE_URL: 'https://example.com' }}
        onEnvChange={onEnvChange}
      />,
    );

    const toggle = screen.getByRole('switch', { name: SWITCH });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(RISK)).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({
        ANTHROPIC_BASE_URL: 'https://example.com',
        CLAUDE_CODE_ENTRYPOINT: 'lobehub',
      });
    });
  });

  it('describes the name being typed and saves it', async () => {
    const onEnvChange = vi.fn();
    render(
      <ClaudeCodeEntrypointSetting
        env={{ CLAUDE_CODE_ENTRYPOINT: 'lobehub' }}
        onEnvChange={onEnvChange}
      />,
    );

    const input = screen.getByDisplayValue('lobehub');
    expect(screen.getByText('Launched by lobehub')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: ' my-app ' } });
    expect(screen.getByText('Launched by my-app')).toBeInTheDocument();
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({ CLAUDE_CODE_ENTRYPOINT: 'my-app' });
    });
  });

  it('falls back to lobehub when cleared and keeps the saved name for an unusable one', async () => {
    const onEnvChange = vi.fn();
    render(
      <ClaudeCodeEntrypointSetting
        env={{ CLAUDE_CODE_ENTRYPOINT: 'my-app' }}
        onEnvChange={onEnvChange}
      />,
    );

    const input = screen.getByDisplayValue('my-app');
    fireEvent.change(input, { target: { value: 'a b; rm -rf' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('my-app');
    expect(onEnvChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({ CLAUDE_CODE_ENTRYPOINT: 'lobehub' });
    });
  });

  // Saves merge into the stored env, so a missing key would keep the old value.
  it('clears the entrypoint with an empty value when turned off', async () => {
    const onEnvChange = vi.fn();
    render(
      <ClaudeCodeEntrypointSetting
        env={{ ANTHROPIC_BASE_URL: 'https://example.com', CLAUDE_CODE_ENTRYPOINT: 'my-app' }}
        onEnvChange={onEnvChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({
        ANTHROPIC_BASE_URL: 'https://example.com',
        CLAUDE_CODE_ENTRYPOINT: '',
      });
    });
  });

  it('reads a cleared entrypoint as off', () => {
    render(<ClaudeCodeEntrypointSetting env={{ CLAUDE_CODE_ENTRYPOINT: '' }} />);

    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();
  });
});
