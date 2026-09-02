import { useReducer } from 'react';

export interface PageTocVisibilityState {
  collapsed: boolean;
  previewOpen: boolean;
  suppressMousePreview: boolean;
}

export type PageTocVisibilityAction =
  | { type: 'collapse' }
  | { type: 'expand' }
  | { type: 'mouse-enter' }
  | { type: 'mouse-leave' }
  | { type: 'mouse-move' }
  | { type: 'preview-close' }
  | { type: 'preview-open' };

export const initialPageTocVisibilityState: PageTocVisibilityState = {
  collapsed: false,
  previewOpen: false,
  suppressMousePreview: false,
};

export const reducePageTocVisibility = (
  state: PageTocVisibilityState,
  action: PageTocVisibilityAction,
): PageTocVisibilityState => {
  switch (action.type) {
    case 'collapse': {
      return { collapsed: true, previewOpen: false, suppressMousePreview: true };
    }
    case 'expand': {
      return { ...state, collapsed: false, previewOpen: false };
    }
    case 'mouse-enter': {
      return state.suppressMousePreview ? state : { ...state, previewOpen: true };
    }
    case 'mouse-leave': {
      return { ...state, previewOpen: false, suppressMousePreview: false };
    }
    case 'mouse-move': {
      return state.suppressMousePreview
        ? { ...state, previewOpen: true, suppressMousePreview: false }
        : state;
    }
    case 'preview-close': {
      return { ...state, previewOpen: false };
    }
    case 'preview-open': {
      return { ...state, previewOpen: true };
    }
  }
};

export const usePageTocVisibility = () => {
  const [state, dispatch] = useReducer(reducePageTocVisibility, initialPageTocVisibilityState);

  return {
    ...state,
    closePreview: () => dispatch({ type: 'preview-close' }),
    collapse: () => dispatch({ type: 'collapse' }),
    expand: () => dispatch({ type: 'expand' }),
    handleMouseEnter: () => dispatch({ type: 'mouse-enter' }),
    handleMouseLeave: () => dispatch({ type: 'mouse-leave' }),
    handleMouseMove: () => dispatch({ type: 'mouse-move' }),
    openPreview: () => dispatch({ type: 'preview-open' }),
  };
};
