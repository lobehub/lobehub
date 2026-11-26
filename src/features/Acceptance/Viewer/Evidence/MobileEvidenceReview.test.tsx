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
const region = { comment: '', evidenceId: 'e1', key: 1, rect: { x: 1, y: 2, width: 3, height: 4 } };

const buildModel = (overrides: Partial<RejectReviewModel> = {}): RejectReviewModel =>
  ({
    activeAnnotations: [],
    activeEvidence: undefined,
    activeIndex: -1,
    annotations: [],
    editableAnnotations: [],
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
    setZoom: vi.fn(),
    stepZoom: vi.fn(),
    submitReject: vi.fn(),
    uploadFiles: vi.fn(),
    ...overrides,
  }) as RejectReviewModel;

const withImage = (overrides: Partial<RejectReviewModel> = {}) =>
  buildModel({
    activeEvidence: evidenceItem,
    activeIndex: 0,
    evidence: [evidenceItem],
    hasEvidence: true,
    ...overrides,
  });

const supplementButton = () =>
  screen.queryByRole('button', { name: /acceptance\.review\.supplementButton/ });
const supplementField = () =>
  screen.queryByRole('textbox', { name: 'acceptance.review.supplement' });
const drawButton = () => screen.queryByRole('button', { name: 'acceptance.review.drawRegion' });
const doneButton = () => screen.queryByRole('button', { name: 'acceptance.review.confirmRegions' });
const submitButton = () =>
  screen.queryByRole('button', { name: 'acceptance.review.confirmReject' });
const follows = (before: Element, after: Element) =>
  Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('MobileEvidenceReview notes', () => {
  it('keeps the notes field on the page, with no button to open it', () => {
    render(<MobileEvidenceReview model={buildModel()} />);

    expect(supplementButton()).not.toBeInTheDocument();
    expect(supplementField()).toBeInTheDocument();
    expect(screen.getByText('acceptance.review.supplement')).toBeInTheDocument();
    expect(screen.getByText('acceptance.review.draftSaved')).toBeInTheDocument();
    expect(screen.getByText('upload-stub')).toBeInTheDocument();
  });

  it('sends what the reviewer types to the model', () => {
    const setComment = vi.fn();
    render(<MobileEvidenceReview model={buildModel({ setComment })} />);

    fireEvent.change(supplementField()!, { target: { value: 'wrong color here' } });

    expect(setComment).toHaveBeenCalledWith('wrong color here');
  });

  it('shows a restored draft in the field', () => {
    render(<MobileEvidenceReview model={buildModel({ comment: 'already typed' })} />);

    expect(supplementField()).toHaveValue('already typed');
  });

  it('shows screenshots that are already attached', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({
          attachments: [{ id: 'att-1', name: 'shot.png', url: 'https://example.com/a.png' }],
        })}
      />,
    );

    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('lists marked regions above the notes field', () => {
    render(
      <MobileEvidenceReview
        model={buildModel({ annotations: [region], editableAnnotations: [region] })}
      />,
    );

    const regions = screen.getByText('acceptance.review.regionComments');
    expect(follows(regions, supplementField()!)).toBe(true);
  });

  it('has no region section until a region is marked', () => {
    render(<MobileEvidenceReview model={withImage()} />);

    expect(screen.queryByText('acceptance.review.regionComments')).toBeNull();
    expect(screen.queryByText('acceptance.review.mobileRegionCommentsEmpty')).toBeNull();
  });
});

describe('MobileEvidenceReview image switcher', () => {
  it('keeps one full-width control under the image: image steps first, zoom after them', () => {
    const stepZoom = vi.fn();
    render(<MobileEvidenceReview model={withImage({ stepZoom, zoom: 1.5 })} />);

    const stage = screen.getByText('stage-stub');
    const previous = screen.getByRole('button', { name: 'acceptance.review.previousImage' });
    const next = screen.getByRole('button', { name: 'acceptance.review.nextImage' });
    const zoomOut = screen.getByRole('button', { name: 'acceptance.review.zoomOut' });
    const zoomIn = screen.getByRole('button', { name: 'acceptance.review.zoomIn' });
    expect(follows(stage, previous)).toBe(true);
    expect(follows(previous, next)).toBe(true);
    expect(follows(next, zoomOut)).toBe(true);
    expect(follows(zoomOut, zoomIn)).toBe(true);

    // The zoom reads the model's zoom, whether a pinch or a button set it.
    expect(screen.getByText('150%')).toBeInTheDocument();
    fireEvent.click(zoomIn);
    expect(stepZoom).toHaveBeenCalledWith(1);
    fireEvent.click(zoomOut);
    expect(stepZoom).toHaveBeenCalledWith(-1);

    expect(screen.queryByText('acceptance.review.mobileBrowseHint')).toBeNull();
  });

  it('counts the image between the two arrows', () => {
    const second = { fileUrl: 'https://example.com/second.png', id: 'e2' };
    render(
      <MobileEvidenceReview
        model={withImage({
          activeEvidence: second,
          activeIndex: 1,
          evidence: [evidenceItem, second],
        })}
      />,
    );

    const counter = screen.getByText('2 / 2');
    expect(counter).toHaveAttribute('aria-label', 'acceptance.review.imageNumber');
    expect(
      follows(screen.getByRole('button', { name: 'acceptance.review.previousImage' }), counter),
    ).toBe(true);
    expect(
      follows(counter, screen.getByRole('button', { name: 'acceptance.review.nextImage' })),
    ).toBe(true);
  });

  it('steps between images and stops at both ends', () => {
    const selectEvidence = vi.fn();
    const second = { fileUrl: 'https://example.com/second.png', id: 'e2' };
    const { unmount } = render(
      <MobileEvidenceReview
        model={withImage({ evidence: [evidenceItem, second], selectEvidence })}
      />,
    );

    expect(screen.getByRole('button', { name: 'acceptance.review.previousImage' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'acceptance.review.nextImage' }));
    expect(selectEvidence).toHaveBeenCalledWith(1);
    unmount();

    render(
      <MobileEvidenceReview
        model={withImage({
          activeEvidence: second,
          activeIndex: 1,
          evidence: [evidenceItem, second],
          selectEvidence,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'acceptance.review.nextImage' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'acceptance.review.previousImage' }));
    expect(selectEvidence).toHaveBeenCalledWith(0);
  });

  it('disables the zoom buttons at the ends of the range', () => {
    const { unmount } = render(<MobileEvidenceReview model={withImage({ zoom: 0.5 })} />);
    expect(screen.getByRole('button', { name: 'acceptance.review.zoomOut' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'acceptance.review.zoomIn' })).toBeEnabled();
    unmount();

    render(<MobileEvidenceReview model={withImage({ zoom: 4 })} />);
    expect(screen.getByRole('button', { name: 'acceptance.review.zoomIn' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'acceptance.review.zoomOut' })).toBeEnabled();
  });

  it('has no switcher when there is no image', () => {
    render(<MobileEvidenceReview model={buildModel()} />);

    expect(screen.queryByRole('button', { name: 'acceptance.review.nextImage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'acceptance.review.zoomIn' })).toBeNull();
  });
});

describe('MobileEvidenceReview marking mode', () => {
  it('enters marking mode from the button between the switcher and the notes', () => {
    const advance = vi.fn();
    render(<MobileEvidenceReview model={withImage({ advance })} />);

    const zoomIn = screen.getByRole('button', { name: 'acceptance.review.zoomIn' });
    expect(follows(zoomIn, drawButton()!)).toBe(true);
    expect(follows(drawButton()!, supplementField()!)).toBe(true);

    fireEvent.click(drawButton()!);
    expect(advance).toHaveBeenCalledWith('toggle-draw');
  });

  it('swaps everything under the image for the region comments and a Done button', () => {
    const advance = vi.fn();
    render(<MobileEvidenceReview model={withImage({ advance, drawing: true })} />);

    expect(drawButton()).not.toBeInTheDocument();
    expect(supplementField()).not.toBeInTheDocument();
    expect(submitButton()).not.toBeInTheDocument();

    // What is left is about the regions: the list (empty so far) and the hint.
    expect(screen.getByText('acceptance.review.regionComments')).toBeInTheDocument();
    expect(screen.getByText('acceptance.review.mobileRegionCommentsEmpty')).toBeInTheDocument();
    expect(screen.queryByText('acceptance.review.mobileDrawHint')).toBeNull();

    // Done leaves the mode; the regions themselves are the model's to keep.
    fireEvent.click(doneButton()!);
    expect(advance).toHaveBeenCalledWith('toggle-draw');
  });

  it('lists the circled regions for their notes while marking', () => {
    render(
      <MobileEvidenceReview
        model={withImage({
          activeAnnotations: [region],
          annotations: [region],
          drawing: true,
          editableAnnotations: [region],
        })}
      />,
    );

    expect(screen.queryByText('acceptance.review.mobileRegionCommentsEmpty')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'acceptance.review.annotationPlaceholder' }),
    ).toBeInTheDocument();
  });

  it('has no marking entry when there is no image to draw on', () => {
    render(<MobileEvidenceReview model={buildModel()} />);

    expect(drawButton()).not.toBeInTheDocument();
    expect(supplementField()).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
  });
});

describe('MobileEvidenceReview submit', () => {
  it('submits from the bottom action once the review can be sent', () => {
    const submitReject = vi.fn();
    const { unmount } = render(<MobileEvidenceReview model={buildModel()} />);
    expect(submitButton()).toBeDisabled();
    unmount();

    render(<MobileEvidenceReview model={buildModel({ canSubmit: true, submitReject })} />);
    expect(follows(supplementField()!, submitButton()!)).toBe(true);
    fireEvent.click(submitButton()!);
    expect(submitReject).toHaveBeenCalled();
  });

  it('reports a failed submit above the button, but not while marking', () => {
    const { unmount } = render(<MobileEvidenceReview model={withImage({ failed: true })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('acceptance.review.submitFailed');
    unmount();

    render(<MobileEvidenceReview model={withImage({ drawing: true, failed: true })} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
