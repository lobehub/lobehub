import { BRANDING_NAME } from '@lobechat/business-const';
import { type SegmentedProps } from '@lobehub/ui';
import { snapdom } from '@zumer/snapdom';
import dayjs from 'dayjs';
import { useCallback, useState } from 'react';

export enum ImageType {
  JPG = 'jpg',
  PNG = 'png',
  SVG = 'svg',
  WEBP = 'webp',
}

export const imageTypeOptions: SegmentedProps['options'] = [
  {
    label: 'JPG',
    value: ImageType.JPG,
  },
  {
    label: 'PNG',
    value: ImageType.PNG,
  },
  {
    label: 'SVG',
    value: ImageType.SVG,
  },
  {
    label: 'WEBP',
    value: ImageType.WEBP,
  },
];

export const getImageUrl = async ({
  imageType,
  id = '#preview',
  width,
}: {
  id?: string;
  imageType: ImageType;
  width?: number;
}) => {
  const dom: HTMLDivElement = document.querySelector(id) as HTMLDivElement;
  let copy: HTMLDivElement = dom;

  if (width) {
    copy = dom.cloneNode(true) as HTMLDivElement;
    copy.style.width = `${width}px`;
    document.body.append(copy);
  }

  const baseOptions = {
    scale: 2,
    width,
  };

  let blob: Blob;

  if (imageType === ImageType.SVG) {
    // For SVG, we need to use the full snapdom API to get the raw SVG string
    const result = await snapdom(width ? copy : dom, baseOptions);
    const svgString = result.toRaw();
    blob = new Blob([svgString], { type: 'image/svg+xml' });
  } else {
    // For raster formats, use toBlob directly with type option
    const blobType = (imageType === ImageType.JPG ? 'jpg' : imageType) as 'png' | 'jpg' | 'webp';
    const blobResult = await snapdom.toBlob(width ? copy : dom, {
      type: blobType,
      useProxy: 'https://proxy.corsfix.com/?',
    });

    if (!blobResult) {
      throw new Error('Failed to generate blob from snapdom');
    }

    blob = blobResult;
  }

  if (width && copy) copy?.remove();

  if (!blob) {
    throw new Error('Blob is undefined');
  }

  // Convert blob to data URL using FileReader
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader result is not a string'));
      }
    });
    reader.addEventListener('error', () =>
      reject(reader.error || new Error('Failed to read blob as data URL')),
    );
    reader.readAsDataURL(blob);
  });
};

export const useScreenshot = ({
  imageType,
  title = 'share',
  id = '#preview',
  width,
}: {
  id?: string;
  imageType: ImageType;
  title?: string;
  width?: number;
}) => {
  const [loading, setLoading] = useState(false);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    try {
      const dataUrl = await getImageUrl({ id, imageType, width });
      const link = document.createElement('a');
      link.download = `${BRANDING_NAME}_${title}_${dayjs().format('YYYY-MM-DD')}.${imageType}`;
      link.href = dataUrl;
      link.click();
      setLoading(false);
    } catch (error) {
      console.error('Failed to download image', error);
      setLoading(false);
    }
  }, [imageType, title]);

  return {
    loading,
    onDownload: handleDownload,
    title,
  };
};
