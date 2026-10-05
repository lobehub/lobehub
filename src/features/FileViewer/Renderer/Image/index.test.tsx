/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImageStage } from './context';
import ImageViewer from './index';

const downloadFile = vi.hoisted(() => vi.fn());
vi.mock('@/utils/client/downloadFile', () => ({ downloadFile }));

const confirmModal = vi.hoisted(() => vi.fn());
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal,
}));

const loadImage = (width = 2000, height = 1000) => {
  const img = document.querySelector('img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  fireEvent.load(img);
  return img;
};

const AddVersionProbe = () => {
  const { addVersion } = useImageStage();
  return (
    <button
      onClick={() =>
        addVersion({
          fileId: 'file_nobg',
          name: 'sunset-no-bg.png',
          operation: 'removeBackground',
          url: 'https://s3/sunset-no-bg.png',
        })
      }
    >
      add-version
    </button>
  );
};

const StageProbe = () => {
  const stage = useImageStage();
  return (
    <div data-testid={'probe'}>
      {stage.fileId}:{stage.naturalSize?.width}x{stage.naturalSize?.height}:{stage.zoom}
    </div>
  );
};

describe('ImageViewer', () => {
  beforeEach(() => downloadFile.mockReset());

  it('renders the top bar with zoom, download and full screen', () => {
    render(<ImageViewer fileId={'file_1'} name={'sunset.png'} url={'https://s3/sunset.png'} />);

    expect(screen.getByRole('button', { name: 'imageViewer.zoomOut' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageViewer.zoomIn' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /imageViewer.fitToScreen \(100%\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageViewer.download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageViewer.fullscreen' })).toBeInTheDocument();
    // No host close action → no close button outside full screen.
    expect(screen.queryByRole('button', { name: 'imageViewer.close' })).not.toBeInTheDocument();
  });

  it('shows the host close action when provided', () => {
    const onClose = vi.fn();
    render(<ImageViewer fileId={'file_1'} url={'https://s3/a.png'} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('zooms with buttons and keyboard, and fits back to 100%', () => {
    render(<ImageViewer fileId={'file_1'} url={'https://s3/a.png'} />);
    loadImage();

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.zoomIn' }));
    expect(screen.getByRole('button', { name: /\(125%\)/ })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('image-viewer'), { key: '+' });
    expect(screen.getByRole('button', { name: /\(156%\)/ })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('image-viewer'), { key: '0' });
    expect(screen.getByRole('button', { name: /\(100%\)/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.zoomOut' }));
    expect(screen.getByRole('button', { name: /\(80%\)/ })).toBeInTheDocument();
  });

  it('downloads the original file', () => {
    render(<ImageViewer fileId={'file_1'} name={'sunset.png'} url={'https://s3/sunset.png'} />);

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.download' }));
    expect(downloadFile).toHaveBeenCalledWith('https://s3/sunset.png', 'sunset.png');
  });

  it('mounts the tools slot only after the image loads, with stage context', () => {
    render(<ImageViewer fileId={'file_1'} tools={<StageProbe />} url={'https://s3/a.png'} />);

    expect(screen.queryByTestId('probe')).not.toBeInTheDocument();
    loadImage(640, 480);
    expect(screen.getByTestId('probe')).toHaveTextContent('file_1:640x480:1');
  });

  it('shows an error with retry when the image fails to load', () => {
    render(<ImageViewer fileId={'file_1'} tools={<StageProbe />} url={'https://s3/broken.png'} />);

    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText('imageViewer.loadFailed')).toBeInTheDocument();
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('imageViewer.retry'));
    expect(screen.queryByText('imageViewer.loadFailed')).not.toBeInTheDocument();
  });

  it('shows a saved edit on stage and switches back to the original', () => {
    render(
      <ImageViewer
        fileId={'file_1'}
        name={'sunset.png'}
        url={'https://s3/sunset.png'}
        tools={
          <>
            <AddVersionProbe />
            <StageProbe />
          </>
        }
      />,
    );
    loadImage(640, 480);
    expect(screen.queryByRole('toolbar', { name: 'imageViewer.version.label' })).toBeNull();

    fireEvent.click(screen.getByText('add-version'));
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://s3/sunset-no-bg.png');
    loadImage(640, 480);
    // Tools now act on the edit, so a follow-up edit chains from it.
    expect(screen.getByTestId('probe')).toHaveTextContent('file_nobg:640x480:1');

    const original = screen.getByRole('button', { name: 'imageViewer.version.original' });
    const edit = screen.getByRole('button', { name: 'imageViewer.tool.removeBackground' });
    expect(edit).toHaveAttribute('aria-pressed', 'true');
    expect(edit).toHaveAttribute('title', 'sunset-no-bg.png');

    fireEvent.click(original);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://s3/sunset.png');
    loadImage(640, 480);
    expect(screen.getByTestId('probe')).toHaveTextContent('file_1:640x480:1');
    expect(original).toHaveAttribute('aria-pressed', 'true');

    // Download follows the version on stage.
    fireEvent.click(edit);
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.download' }));
    expect(downloadFile).toHaveBeenCalledWith('https://s3/sunset-no-bg.png', 'sunset-no-bg.png');
  });

  // Regression: the tools remount while a version loads, which dropped the
  // unsent annotations and comments kept inside them.
  it('keeps unsent marks per version across version switches', () => {
    const MarkupProbe = () => {
      const { markup, setMarkup } = useImageStage();
      return (
        <button
          onClick={() =>
            setMarkup({
              ...markup,
              comments: [
                ...markup.comments,
                { anchor: { point: { x: 0.5, y: 0.5 }, type: 'point' }, id: 'c1', text: 'hi' },
              ],
            })
          }
        >
          {`marks:${markup.comments.length}`}
        </button>
      );
    };
    render(
      <ImageViewer
        fileId={'file_1'}
        url={'https://s3/sunset.png'}
        tools={
          <>
            <AddVersionProbe />
            <MarkupProbe />
          </>
        }
      />,
    );
    loadImage();
    fireEvent.click(screen.getByText('marks:0'));
    expect(screen.getByText('marks:1')).toBeInTheDocument();

    // A saved edit goes on stage: its own marks start empty.
    fireEvent.click(screen.getByText('add-version'));
    loadImage();
    expect(screen.getByText('marks:0')).toBeInTheDocument();

    // Back on the original, its marks are still there.
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.version.original' }));
    loadImage();
    expect(screen.getByText('marks:1')).toBeInTheDocument();
  });

  // Unsent marks exist only in the viewer, so closing asks before dropping them.
  it('confirms before closing with unsent marks', () => {
    const MarkProbe = () => {
      const { setMarkup } = useImageStage();
      return (
        <button
          onClick={() =>
            setMarkup({
              comments: [],
              shapes: [{ color: '#f00', points: [], size: 0.01, type: 'brush' }],
            })
          }
        >
          mark
        </button>
      );
    };
    const onClose = vi.fn();
    render(
      <ImageViewer
        fileId={'file_1'}
        tools={<MarkProbe />}
        url={'https://s3/a.png'}
        onClose={onClose}
      />,
    );
    loadImage();
    fireEvent.click(screen.getByText('mark'));
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.close' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'imageViewer.markup.discardConfirm.title' }),
    );
    confirmModal.mock.calls[0][0].onOk();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression: the host Close stayed enabled during a save that cannot be
  // aborted, so the result landed in a viewer that no longer existed.
  it('disables Close while a tool reports a save in flight', () => {
    const BusyProbe = () => {
      const { setBusy } = useImageStage();
      return <button onClick={() => setBusy(true)}>busy</button>;
    };
    const onClose = vi.fn();
    render(
      <ImageViewer
        fileId={'file_1'}
        tools={<BusyProbe />}
        url={'https://s3/a.png'}
        onClose={onClose}
      />,
    );
    loadImage();
    fireEvent.click(screen.getByText('busy'));

    const close = screen.getByRole('button', { name: 'imageViewer.close' });
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('drops saved versions when another file opens', () => {
    const { rerender } = render(
      <ImageViewer fileId={'file_1'} tools={<AddVersionProbe />} url={'https://s3/a.png'} />,
    );
    loadImage();
    fireEvent.click(screen.getByText('add-version'));
    expect(screen.getByRole('toolbar', { name: 'imageViewer.version.label' })).toBeInTheDocument();

    rerender(
      <ImageViewer fileId={'file_2'} tools={<AddVersionProbe />} url={'https://s3/b.png'} />,
    );
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://s3/b.png');
    expect(screen.queryByRole('toolbar', { name: 'imageViewer.version.label' })).toBeNull();
  });

  it('renders nothing without a url', () => {
    const { container } = render(<ImageViewer fileId={'file_1'} url={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
