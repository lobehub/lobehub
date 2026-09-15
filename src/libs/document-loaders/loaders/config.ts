export const MAX_DOCUMENT_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENT_CHUNKS = 100_000;
export const MAX_CSV_ROWS = 100_000;
export const MAX_PDF_PAGES = 1000;

const getLoaderConfig = () => ({
  chunkOverlap: 400,
  chunkSize: 800,
  maxChunks: MAX_DOCUMENT_CHUNKS,
});

export const loaderConfig = getLoaderConfig();

export const assertWithinLoaderLimit = (value: number, limit: number, label: string) => {
  if (value > limit) {
    throw new Error(`${label} exceeds maximum allowed limit of ${limit}`);
  }
};
