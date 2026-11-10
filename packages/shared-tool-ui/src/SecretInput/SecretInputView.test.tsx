/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui', () => ({
  Button: (props: any) => <button {...props} />,
  cssVar: { colorError: 'var(--error)', colorWarning: 'var(--warn)' },
  Flexbox: (props: any) => <div {...props} />,
  Icon: (props: any) => <span {...props} />,
  InputPassword: (props: any) => <input type="password" {...props} />,
  Text: (props: any) => <span {...props} />,
}));
vi.mock('lucide-react', () => ({ CircleAlert: (props: any) => <svg {...props} /> }));

import SecretInputView, { isSecretSubmitDisabled } from './SecretInputView';

const labels = {
  cancel: 'Skip',
  confirmProse: 'Save anyway',
  placeholder: (field: string) => `Enter ${field}`,
  proseWarning: (fields: string[]) => `Prose-looking: ${fields.join(', ')}`,
  submit: 'Save',
  submitting: 'Saving…',
};

describe('isSecretSubmitDisabled', () => {
  it('keeps a completed form submittable', () => {
    expect(isSecretSubmitDisabled({ complete: true, inert: false, proseWarning: undefined })).toBe(
      false,
    );
  });

  it('disables submit when blocked even though the form was completed', () => {
    // Lookup failed / permission lost / type mismatch after completion: the
    // fields are replaced by the reason, so Save must not go through.
    expect(
      isSecretSubmitDisabled({ blockedReason: 'Lookup failed', complete: true, inert: false }),
    ).toBe(true);
  });

  it('disables an incomplete form without a pending prose confirmation', () => {
    expect(isSecretSubmitDisabled({ complete: false, inert: false })).toBe(true);
  });

  it('disables the ordinary Save while a prose confirmation is pending', () => {
    // Codex round-5 P2 (#4331827545): handleSubmit rejects every ordinary
    // Save until confirmProseSubmit runs, so a clickable Save would only
    // look stuck. The confirm control has its own gates and stays enabled.
    expect(isSecretSubmitDisabled({ complete: true, inert: false, proseWarning: ['F'] })).toBe(
      true,
    );
  });

  it('disables while inert', () => {
    expect(isSecretSubmitDisabled({ complete: true, inert: true })).toBe(true);
  });
});

describe('SecretInputView blocked submit', () => {
  afterEach(cleanup);

  it('renders a disabled Save when a completed form later becomes blocked', () => {
    const { getByRole } = render(
      <SecretInputView
        blockedReason={'A credential with this key already exists with a different type'}
        fields={['OPENAI_API_KEY']}
        labels={labels}
        onCancel={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const save = getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('disables the prose-confirm button when the form becomes blocked', async () => {
    // Codex round-2 P2 (#4330386329): a prose-looking value held for
    // confirmation must not reach the sink once the form revalidates to a
    // blocked state — the confirm button bypasses isSecretSubmitDisabled,
    // so it needs its own blockedReason gate.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container, getByRole, rerender } = render(
      <SecretInputView
        fields={['OPENAI_API_KEY']}
        labels={labels}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'please verify my credentials now' } });
    });

    // First Save press holds the submit with a prose warning.
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Save' }));
    });
    const confirm = getByRole('button', { name: 'Save anyway' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);

    // The form then revalidates to a blocked state.
    rerender(
      <SecretInputView
        blockedReason={'A credential with this key already exists with a different type'}
        fields={['OPENAI_API_KEY']}
        labels={labels}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const blockedConfirm = getByRole('button', { name: 'Save anyway' }) as HTMLButtonElement;
    expect(blockedConfirm.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(blockedConfirm);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('holds the ordinary Save disabled while the prose guard is active', async () => {
    // Codex round-5 P2 (#4331827545): after the warning appears, the primary
    // Save must render disabled instead of staying clickable-but-rejected;
    // only "Save anyway" can submit a prose-looking value.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container, getByRole } = render(
      <SecretInputView
        fields={['OPENAI_API_KEY']}
        labels={labels}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'please verify my credentials now' } });
    });

    // First Save press raises the prose warning and disables the primary Save.
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Save' }));
    });
    const save = getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const confirm = getByRole('button', { name: 'Save anyway' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(confirm.disabled).toBe(false);

    // Pressing the held Save (e.g. a stale pointer event) must not submit.
    await act(async () => {
      fireEvent.click(save);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
