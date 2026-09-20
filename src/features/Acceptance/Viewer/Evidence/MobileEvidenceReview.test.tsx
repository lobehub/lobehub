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

// The image stage measures itself and draws on a canvas — neither exists in
// jsdom, and neither is what these tests are about.
vi.mock('./EvidenceStage', () => ({
  EvidenceStage: () => <div>stage-stub</div>,
}));

afterEach(cleanup);

const evidenceItem = { fileUrl: 'https://example.com/shot.png', id: 'e1' };

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

const supplementButton = () =>
  screen.getByRole('button', { name: /acceptance\.review\.supplementButton/ });
const supplementField = () =>
  screen.queryByRole('textbox', { name: 'acceptance.review.supplement' });
const drawButton = () => screen.queryByRole('button', { name: 'acceptance.review.drawRegion' });

describe('MobileEvidenceReview notes button', () => {
  it('keeps the notes closed by default and opens them on tap', () => {
    render(<MobileEvidenceReview model={buildModel()} />);

    // Closed: the field is not on the page; the button says so itself.
    expect(supplementButton()).toHaveAttribute('aria-expanded', 'false');
    expect(supplementButton()).toHaveTextContent('acceptance.review.supplementButton');
    expect(supplementField()).not.toBeInTheDocument();

    // Tapping the button opens the field in place.
    fireEvent.click(supplementButton());
    expect(supplementButton()).toHaveAttribute('aria-expanded', 'true');
    expect(supplementField()).toBeInTheDocument();
    expect(screen.getByText('upload-stub')).toBeInTheDocument();
  });

  it('continues the reviewer action after opening: typing lands in the model', () => {
    const setComment = vi.fn();
    render(<MobileEvidenceReview model={buildModel({ setComment })} />);

    fireEvent.click(supplementButton());
    fireEvent.change(supplementField()!, { target: { value: 'wrong color here' } });

    expect(setComment).toHaveBeenCalledWith('wrong color here');
  });

  it('closes on a second tap, keeping the button honest about saved content', () => {
    render(<MobileEvidenceReview model={buildModel({ comment: 'already typed' })} />);

    // A restored draft opens itself — never hide words the user wrote.
    expect(supplementField()).toBeInTheDocument();

    fireEvent.click(supplementButton());
    expect(supplementField()).not.toBeInTheDocument();
    // The closed button names the draft instead of the plain label.
    expect(supplementButton()).toHaveTextContent('acceptance.review.supplementButtonDraft');
  });

  it('auto-opens when screenshots are already attached', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({
          attachments: [{ id: 'att-1', name: 'shot.png', url: 'https://example.com/a.png' }],
        })}
      />,
    );

    expect(supplementField()).toBeInTheDocument();
  });

  it('keeps marked regions visible without auto-opening the notes', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({
          annotations: [
            { comment: '', evidenceId: 'e1', key: 1, rect: { x: 1, y: 2, width: 3, height: 4 } },
          ],
        })}
      />,
    );

    // Regions have their own always-visible section; the notes stay closed.
    expect(screen.getByText('acceptance.review.regionComments')).toBeInTheDocument();
    expect(supplementField()).not.toBeInTheDocument();
    expect(supplementButton()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('MobileEvidenceReview draw button', () => {
  it('sits beside the notes button and switches drawing on', () => {
    const advance = vi.fn();
    render(
      <MobileEvidenceReview
        model={buildModel({
          activeEvidence: evidenceItem,
          activeIndex: 0,
          advance,
          evidence: [evidenceItem],
          hasEvidence: true,
        })}
      />,
    );

    // Not pressed while drags pan the image.
    expect(drawButton()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(drawButton()!);
    expect(advance).toHaveBeenCalledWith('toggle-draw');
  });

  it('shows as pressed while drags mark regions', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({
          activeEvidence: evidenceItem,
          activeIndex: 0,
          drawing: true,
          evidence: [evidenceItem],
          hasEvidence: true,
        })}
      />,
    );

    expect(drawButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('acceptance.review.mobileDrawHint')).toBeInTheDocument();
  });

  it('is absent when there is no image to draw on', () => {
    render(<MobileEvidenceReview model={buildModel()} />);

    expect(drawButton()).not.toBeInTheDocument();
    expect(supplementButton()).toBeInTheDocument();
  });
});
