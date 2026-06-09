export class PlatformUnsupportedError extends Error {
  constructor(platform: string, operation: string) {
    super(
      `The "${operation}" operation is not supported on ${platform}. ` +
        `This is a platform limitation, not a configuration issue.`,
    );
    this.name = 'PlatformUnsupportedError';
  }
}
