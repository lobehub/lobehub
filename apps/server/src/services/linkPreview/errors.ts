/** The page could not be read just now; whether it has a card is unknown. */
export class LinkPreviewUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Link preview unavailable', options);
    this.name = 'LinkPreviewUnavailableError';
  }
}
