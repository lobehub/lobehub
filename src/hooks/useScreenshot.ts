import { BRANDING_NAME } from '@lobechat/business-const';
import { type SegmentedProps } from '@lobehub/ui';
import { snapdom } from '@zumer/snapdom';
import dayjs from 'dayjs';
import { useCallback, useState } from 'react';

/**
 * Walk the DOM tree and resolve CSS custom properties by inlining computed values.
 * When snapDOM serializes the DOM through SVG foreignObject → canvas, CSS custom
 * properties (e.g. `--prism-background`) are not resolved in the canvas context.
 * This function ensures all critical computed values are set as inline styles,
 * fixing code block backgrounds and other variable-dependent styles.
 */
const resolveCSSVariables = (root: HTMLElement) => {
  const treeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
  );
  const relevantProperties = [
    'background',
    'background-color',
    'background-image',
    'color',
    'opacity',
    'border-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'fill',
    'stroke',
    'stroke-width',
    'stop-color',
    'box-shadow',
    'text-decoration-color',
    'text-shadow',
    'outline-color',
  ];

  let node: Node | null;
  /* eslint-disable-next-line no-cond-assign */
  while ((node = treeWalker.nextNode())) {
    const el = node as HTMLElement;
    const computed = getComputedStyle(el);

    for (const prop of relevantProperties) {
      const resolvedValue = computed.getPropertyValue(prop);
      if (
        resolvedValue &&
        resolvedValue !== '' &&
        resolvedValue !== 'initial' &&
        resolvedValue !== 'inherit' &&
        resolvedValue !== 'unset'
      ) {
        el.style.setProperty(prop, resolvedValue, 'important');
      }
    }
  }
};

/**
 * Ensure all inline SVG elements have proper xmlns attributes.
 * When snapDOM serializes the DOM through XMLSerializer into a canvas context,
 * inline SVGs without explicit `xmlns` attributes may fail to render. This
 * adds `xmlns="http://www.w3.org/2000/svg"` to all <svg> elements and
 * `xmlns:xlink` where xlink:href attributes are present.
 */
const ensureSVGNamespaces = (root: HTMLElement) => {
  root.querySelectorAll('svg').forEach((svg) => {
    if (!svg.getAttribute('xmlns')) {
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
  });

  root.querySelectorAll('[xlink\\:href]').forEach((el) => {
    const svgRoot = el.closest('svg');
    if (svgRoot && !svgRoot.getAttribute('xmlns:xlink')) {
      svgRoot.setAttribute(
        'xmlns:xlink',
        'http://www.w3.org/1999/xlink',
      );
    }
  });
};

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

  // Always clone to avoid modifying the original DOM with inline style mutations
  const copy = dom.cloneNode(true) as HTMLDivElement;

  if (width) {
    copy.style.width = `${width}px`;
  }

  document.body.append(copy);

  // Resolve CSS custom properties and ensure SVG namespaces before serialization
  resolveCSSVariables(copy);
  ensureSVGNamespaces(copy);

  const baseOptions = {
    scale: 2,
    width,
  };

  let blob: Blob;

  if (imageType === ImageType.SVG) {
    // For SVG, we need to use the full snapdom API to get the raw SVG string
    const result = await snapdom(copy, baseOptions);
    const svgString = result.toRaw();
    blob = new Blob([svgString], { type: 'image/svg+xml' });
  } else {
    // For raster formats, use toBlob directly with type option
    const blobType = (imageType === ImageType.JPG ? 'jpg' : imageType) as 'png' | 'jpg' | 'webp';
    const blobResult = await snapdom.toBlob(copy, {
      type: blobType,
      useProxy: 'https://proxy.corsfix.com/?',
    });

    if (!blobResult) {
      throw new Error('Failed to generate blob from snapdom');
    }

    blob = blobResult;
  }

  copy?.remove();

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
