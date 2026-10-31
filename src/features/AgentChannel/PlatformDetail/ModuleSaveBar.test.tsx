/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import agentEn from '../../../../packages/locales/src/default/agent';
import { ModuleSaveBar } from './ModuleSaveBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (agentEn as Record<string, string>)[key] ?? key }),
}));

const en = agentEn as Record<string, string>;
const noop = () => {};

describe('ModuleSaveBar', () => {
  it('is always there, so a person sees that this block is saved by hand, but cannot be pressed while nothing changed', () => {
    render(<ModuleSaveBar dirty={false} onDiscard={noop} onSave={noop} />);

    expect(screen.getByRole('button', { name: en['channel.module.save'] })).toBeDisabled();
    expect(screen.queryByText(en['channel.module.unsaved'])).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['channel.discard'] })).not.toBeInTheDocument();
  });

  it('says there are unsaved changes and offers to save or discard them', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<ModuleSaveBar dirty onDiscard={onDiscard} onSave={onSave} />);

    expect(screen.getByText(en['channel.module.unsaved'])).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en['channel.module.save'] }));
    fireEvent.click(screen.getByRole('button', { name: en['channel.discard'] }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('holds both buttons while it saves, so the block cannot be saved twice', () => {
    const onSave = vi.fn();
    render(<ModuleSaveBar dirty saving onDiscard={noop} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['channel.module.save']) }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: en['channel.discard'] })).toBeDisabled();
  });

  it('cannot be used when the page is read-only', () => {
    render(<ModuleSaveBar dirty disabled onDiscard={noop} onSave={noop} />);

    expect(screen.getByRole('button', { name: en['channel.module.save'] })).toBeDisabled();
    expect(screen.getByRole('button', { name: en['channel.discard'] })).toBeDisabled();
  });
});
