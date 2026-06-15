import { render, screen } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localFileKeys } from '@/libs/swr/keys';

import MarkdownImage from './MarkdownImage';

const mockImage = vi.hoisted(() => vi.fn());
const mockUseClientDataSWR = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  Image: ({
    alt,
    classNames,
    objectFit,
    src,
    styles,
    variant,
  }: {
    alt?: string;
    classNames?: { image?: string };
    objectFit?: string;
    src?: string;
    styles?: { image?: CSSProperties };
    variant?: string;
  }) => {
    mockImage({ alt, classNames, objectFit, src, styles, variant });

    return (
      <img
        alt={alt}
        className={classNames?.image}
        data-object-fit={objectFit}
        data-testid="lobe-image"
        data-variant={variant}
        src={src}
        style={styles?.image}
      />
    );
  },
}));

vi.mock('antd-style', () => ({
  cssVar: {
    colorFillQuaternary: 'var(--color-fill-quaternary)',
  },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: mockUseClientDataSWR,
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    getLocalFilePreview: vi.fn(),
  },
}));

describe('MarkdownImage', () => {
  beforeEach(() => {
    mockImage.mockClear();
    mockUseClientDataSWR.mockReset();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:markdown-image'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('renders remote markdown images with the LobeHub Image component', () => {
    mockUseClientDataSWR.mockReturnValue({});

    render(
      <MarkdownImage
        alt="remote"
        className="markdown-img"
        markdownFilePath="/repo/report.md"
        src="https://example.com/screenshot.png"
        style={{ width: 320 }}
        workingDirectory="/repo"
      />,
    );

    const image = screen.getByTestId('lobe-image');
    expect(image).toHaveAttribute('src', 'https://example.com/screenshot.png');
    expect(image).toHaveClass('markdown-img');
    expect(image).toHaveStyle({ maxWidth: '100%', width: '320px' });
    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        objectFit: 'contain',
        src: 'https://example.com/screenshot.png',
        variant: 'borderless',
      }),
    );
    expect(mockUseClientDataSWR).toHaveBeenCalledWith(null, expect.any(Function), {
      revalidateOnFocus: false,
    });
  });

  it('resolves relative markdown images and renders the loaded blob through LobeHub Image', () => {
    mockUseClientDataSWR.mockReturnValue({
      data: {
        blob: new Blob(['image']),
        type: 'image',
      },
    });

    render(
      <MarkdownImage
        alt="local"
        deviceId="device-1"
        markdownFilePath="/repo/.records/report.md"
        src="assets/screenshot.png"
        workingDirectory="/repo"
      />,
    );

    expect(screen.getByTestId('lobe-image')).toHaveAttribute('src', 'blob:markdown-image');
    expect(mockUseClientDataSWR).toHaveBeenCalledWith(
      localFileKeys.preview({
        accept: 'image',
        deviceId: 'device-1',
        filePath: '/repo/.records/assets/screenshot.png',
        workingDirectory: '/repo',
      }),
      expect.any(Function),
      { revalidateOnFocus: false },
    );
  });

  it('shows a stable placeholder while a relative markdown image is loading', () => {
    mockUseClientDataSWR.mockReturnValue({});

    render(
      <MarkdownImage
        alt="local"
        markdownFilePath="/repo/report.md"
        src="assets/screenshot.png"
        workingDirectory="/repo"
      />,
    );

    expect(screen.queryByTestId('lobe-image')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'local' })).toBeInTheDocument();
  });
});
