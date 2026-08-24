export const applyRuntimeFrameProtections = <T extends Response>(response: T): T => {
  // The official standalone image is built with DOCKER=true. Keeping this check
  // in the request path lets operators opt out when the published image starts.
  if (process.env.DOCKER === 'true' && process.env.ENABLED_CSP !== '0') {
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none';");
  }

  return response;
};
