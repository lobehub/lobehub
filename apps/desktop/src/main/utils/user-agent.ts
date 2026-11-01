import { app } from 'electron';

type RequestHeaders = Headers | Record<string, number | string | string[] | undefined>;

const DESKTOP_USER_AGENT_NAME = 'LobeHub Desktop';

export const getDesktopUserAgent = () => `${DESKTOP_USER_AGENT_NAME}/${app.getVersion()}`;

export const setDesktopUserAgentHeader = (headers: RequestHeaders) => {
  const userAgent = getDesktopUserAgent();

  if (headers instanceof Headers) {
    headers.set('User-Agent', userAgent);
    return;
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      delete headers[key];
    }
  }

  headers['User-Agent'] = userAgent;
};
