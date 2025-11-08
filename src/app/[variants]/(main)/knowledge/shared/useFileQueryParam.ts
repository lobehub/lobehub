import { useSearchParams } from 'react-router-dom';

/**
 * Query parameter key for file modal
 * Changed from 'files' to 'file' for better semantics
 */
export const FILE_MODAL_QUERY_KEY = 'file';

/**
 * Hook to get and set the file modal ID from URL query parameters
 * Uses react-router-dom's useSearchParams for MemoryRouter compatibility
 * Supports both ?file=[id] and legacy ?files=[id]
 */
export const useFileModalId = (): string | undefined => {
  const [searchParams] = useSearchParams();

  // Support both 'file' and legacy 'files' for backwards compatibility
  return searchParams.get(FILE_MODAL_QUERY_KEY) ?? searchParams.get('files') ?? undefined;
};

/**
 * Hook to set the file modal ID in the URL query parameters
 * Uses ?file=[id] format for the new knowledge routes
 */
export const useSetFileModalId = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  return (id?: string) => {
    const newParams = new URLSearchParams(searchParams);

    // Remove both new and legacy query params
    newParams.delete(FILE_MODAL_QUERY_KEY);
    newParams.delete('files');

    if (id) {
      newParams.set(FILE_MODAL_QUERY_KEY, id);
    }

    setSearchParams(newParams, { replace: true });
  };
};

/**
 * Standalone function to set file modal ID (for use outside hooks)
 * This creates a callback that can be passed to components
 */
export const createSetFileModalId = (setSearchParams: ReturnType<typeof useSearchParams>[1]) => {
  return (id?: string) => {
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);

        // Remove both new and legacy query params
        newParams.delete(FILE_MODAL_QUERY_KEY);
        newParams.delete('files');

        if (id) {
          newParams.set(FILE_MODAL_QUERY_KEY, id);
        }

        return newParams;
      },
      { replace: true },
    );
  };
};
