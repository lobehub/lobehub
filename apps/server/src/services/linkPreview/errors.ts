/** The page could not be read just now; whether it has a card is unknown. */
export class LinkPreviewUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Link preview unavailable', options);
    this.name = 'LinkPreviewUnavailableError';
  }
}

/**
 * The viewer has spent their budget of page reads for now. Never cached: it
 * says nothing about the page, and other viewers may still read it.
 */
export class LinkPreviewRateLimitedError extends Error {
  constructor() {
    super('Link preview rate limit reached');
    this.name = 'LinkPreviewRateLimitedError';
  }
}
