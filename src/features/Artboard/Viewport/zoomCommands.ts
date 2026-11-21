export type ZoomCommand = 'in' | 'out' | 'fit' | 'actual';

export const ZOOM_STEP = 1.25;

interface ZoomKey {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export const zoomCommandFromKey = (event: ZoomKey): ZoomCommand | undefined => {
  if (event.altKey) return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod) {
    if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+') return 'in';
    if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-')
      return 'out';
    return;
  }
  if (!event.shiftKey) return;
  if (event.code === 'Digit1') return 'fit';
  if (event.code === 'Digit0') return 'actual';
};

export const zoomFactor = (command: Exclude<ZoomCommand, 'fit'>, k: number) => {
  switch (command) {
    case 'in': {
      return ZOOM_STEP;
    }
    case 'out': {
      return 1 / ZOOM_STEP;
    }
    case 'actual': {
      return 1 / k;
    }
  }
};

export const formatZoom = (k: number) => `${Math.round(k * 100)}%`;
