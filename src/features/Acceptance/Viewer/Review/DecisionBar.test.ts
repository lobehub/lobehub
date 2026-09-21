import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import verify from '../../../../../packages/locales/src/default/verify';
import DecisionBar from './DecisionBar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

describe('DecisionBar copy', () => {
  it('keeps the copy prompt action and uses Fix for rerunning the repair', () => {
    // Regression (#18843): the rerun handoff was collapsed into copy-only.
    // Embedded drafts into the composer; standalone copies the repair prompt — both hang off these keys.
    expect(verify['acceptance.bar.copyReview']).toBe('Copy repair prompt');
    expect(verify['acceptance.bar.rerun']).toBe('Fix');
    expect(verify['acceptance.bar.rerunDrafted']).toBe(
      'Drafted into your composer — review and send it.',
    );
    expect(verify['acceptance.bar.rerunSent']).toBe(
      'Sent to the origin conversation — the repair round is starting.',
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
