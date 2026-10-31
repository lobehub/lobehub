export class UnderstandingProviderContextUnavailableError extends Error {
  constructor() {
    super('Current onboarding Understanding provider context is unavailable');
    this.name = 'UnderstandingProviderContextUnavailableError';
  }
}
