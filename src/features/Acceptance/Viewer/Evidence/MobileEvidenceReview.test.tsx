import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RejectReviewModel } from '../Review/useRejectReview';
import { MobileEvidenceReview } from './MobileEvidenceReview';

vi.mock('./attachments', () => ({
  AttachmentUploadButton: (props: { disabled?: boolean }) => (
    <button disabled={props.disabled} type={'button'}>
      upload-stub
    </button>
  ),
  AttachmentStrip: ({ attachments }: { attachments: { id: string; name: string }[] }) =>
    attachments.length > 0 ? (
      <div>
        {attachments.map((item) => (
          <div key={item.id}>{item.name}</div>
        ))}
      </div>
    ) : null,
}));

afterEach(cleanup);

const buildModel = (overrides: Partial<RejectReviewModel> = {}): RejectReviewModel =>
  ({
    activeAnnotations: [],
    activeEvidence: undefined,
    activeIndex: -1,
    annotations: [],
    attachments: [],
    canSubmit: false,
    canvas: { onDraw: vi.fn(), onRemove: vi.fn(), onUpdate: vi.fn() },
    comment: '',
    drawing: false,
    evidence: [],
    failed: false,
    handlePaste: vi.fn(),
    hasEvidence: false,
    loading: false,
    uploading: false,
    zoom: 1,
    advance: vi.fn(),
    close: vi.fn(),
    editAnnotation: vi.fn(),
    jumpToRegion: vi.fn(),
    removeAnnotation: vi.fn(),
    removeAttachment: vi.fn(),
    selectEvidence: vi.fn(),
    setComment: vi.fn(),
    stepZoom: vi.fn(),
    submitReject: vi.fn(),
    uploadFiles: vi.fn(),
    ...overrides,
  }) as RejectReviewModel;

const supplementToggle = () =>
  screen.getByRole('button', { name: /acceptance\.review\.supplement/ });
const supplementField = () =>
  screen.queryByRole('textbox', { name: 'acceptance.review.supplement' });

describe('MobileEvidenceReview supplement fold', () => {
  it('folds the supplement by default and reveals it on tap', () => {
    render(<MobileEvidenceReview model={buildModel()} />);

    // Folded: the field is not on the page, the fold says so itself.
    expect(supplementToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('acceptance.review.supplementFoldedEmpty')).toBeInTheDocument();
    expect(supplementField()).not.toBeInTheDocument();

    // Tapping the header opens the field in place.
    fireEvent.click(supplementToggle());
    expect(supplementToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(supplementField()).toBeInTheDocument();
    expect(screen.getByText('upload-stub')).toBeInTheDocument();
  });

  it('continues the reviewer action after expanding: typing lands in the model', () => {
    const setComment = vi.fn();
    render(<MobileEvidenceReview model={buildModel({ setComment })} />);

    fireEvent.click(supplementToggle());
    fireEvent.change(supplementField()!, { target: { value: 'wrong color here' } });

    expect(setComment).toHaveBeenCalledWith('wrong color here');
  });

  it('folds back on a second tap, keeping the summary honest about saved content', () => {
    render(<MobileEvidenceReview model={buildModel({ comment: 'already typed' })} />);

    // A restored draft opens itself — never fold away words the user wrote.
    expect(supplementField()).toBeInTheDocument();

    fireEvent.click(supplementToggle());
    expect(supplementField()).not.toBeInTheDocument();
    // The folded row names the draft instead of the empty "optional" hint.
    expect(screen.getByText('acceptance.review.supplementFoldedDraft')).toBeInTheDocument();
  });

  it('auto-expands when screenshots are already attached', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({
          attachments: [{ id: 'att-1', name: 'shot.png', url: 'https://example.com/a.png' }],
        })}
      />,
    );

    expect(supplementField()).toBeInTheDocument();
  });

  it('keeps marked regions visible above the fold without auto-expanding the supplement', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({
          annotations: [
            { comment: '', evidenceId: 'e1', key: 1, rect: { x: 1, y: 2, width: 3, height: 4 } },
          ],
        })}
      />,
    );

    // Regions have their own always-visible section; the supplement stays folded.
    expect(screen.getByText('acceptance.review.regionComments')).toBeInTheDocument();
    expect(supplementField()).not.toBeInTheDocument();
    expect(supplementToggle()).toHaveAttribute('aria-expanded', 'false');
  });
});
