import { ModalHost } from '@lobehub/ui/base-ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as I18next from 'i18next';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import verify from '../../../../../packages/locales/src/default/verify';
import DecisionBar from './DecisionBar';
import { openRejectModal } from './modals';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof I18next>()),
  t: (key: string) => key,
}));
afterEach(cleanup);

describe('DecisionBar copy', () => {
  it('keeps the copy prompt action and uses Fix for rerunning the repair', () => {
    // Regression (#18843): the rerun handoff was collapsed into copy-only.
    // Embedded drafts into the composer; standalone copies the repair prompt — both hang off these keys.
    expect(verify['acceptance.bar.copyReview']).toBe('Copy repair prompt');
    expect(verify['acceptance.bar.rerun']).toBe('Fix');
    expect(verify['acceptance.bar.rerunDrafted']).toBe(
      'Added to your composer — review and send it.',
    );
    expect(verify['acceptance.bar.rerunSent']).toBe(
      'Sent to the source conversation — the repair round is starting.',
    );
  });
});

const props = {
  acceptedCount: 0,
  feedbackCount: 1,
  ignoredCount: 0,
  needsFixCount: 1,
  onAccept: vi.fn(),
  onAddComment: vi.fn(),
  onCopyReview: vi.fn(),
  onOpenFeedback: vi.fn(),
  onRejectComment: vi.fn(),
  onRerun: vi.fn(),
  pending: false,
  rerunAvailable: true,
  rerunPending: false,
  state: 'settled' as const,
  statusText: 'Needs a fix',
  totalCount: 1,
};

it('standalone only copies repair instructions even when an origin can rerun', () => {
  render(createElement(DecisionBar, { ...props, embedded: false }));
  expect(screen.queryByRole('button', { name: 'acceptance.bar.rerun' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'acceptance.bar.copyReview' }));
  expect(props.onCopyReview).toHaveBeenCalledOnce();
  expect(props.onRerun).not.toHaveBeenCalled();
});

it('the portal hands the repair to its conversation', () => {
  render(createElement(DecisionBar, { ...props, embedded: true }));
  expect(screen.queryByRole('button', { name: 'acceptance.bar.copyReview' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'acceptance.bar.rerun' }));
  expect(props.onRerun).toHaveBeenCalledOnce();
});

it('keeps the repair prompt available after an aggregate rejection', () => {
  render(
    createElement(DecisionBar, { ...props, embedded: false, feedbackCount: 0, state: 'rejected' }),
  );
  expect(screen.getByRole('button', { name: 'acceptance.bar.copyReview' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'acceptance.bar.rerun' })).toBeNull();
});

it.each(['', '   ', '  Please add dark mode evidence  '])(
  'allows returning a delivery with an optional reason (%j)',
  async (reason) => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    render(createElement(ModalHost));
    render(
      createElement(DecisionBar, {
        ...props,
        feedbackCount: 0,
        needsFixCount: 0,
        onRejectComment: () => openRejectModal({ onConfirm }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'acceptance.bar.rejectComment' }));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: reason } });
    const submit = screen.getByRole('button', { name: 'acceptance.actions.confirmReject' });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(reason.trim()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
);
