import type {
  RequestCookies as RequestCookiesType,
  ResponseCookies as ResponseCookiesType,
} from 'next/dist/compiled/@edge-runtime/cookies';
import edgeRuntimeCookies from 'next/dist/compiled/@edge-runtime/cookies';
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { requireRequestContext } from './context';

const { RequestCookies, ResponseCookies } = edgeRuntimeCookies as {
  RequestCookies: typeof RequestCookiesType;
  ResponseCookies: typeof ResponseCookiesType;
};

export const headers = async (): Promise<ReadonlyHeaders> =>
  new Headers(requireRequestContext('headers').request.headers) as ReadonlyHeaders;

export const cookies = async (): Promise<ReadonlyRequestCookies> => {
  const { request, responseHeaders } = requireRequestContext('cookies');
  const requestCookies = new RequestCookies(request.headers);
  const responseCookies = new ResponseCookies(responseHeaders);

  const syncReadsWithWrites = () => {
    for (const cookie of responseCookies.getAll()) {
      if (cookie.value === '') requestCookies.delete(cookie.name);
      else requestCookies.set(cookie.name, cookie.value);
    }
  };
  syncReadsWithWrites();

  const compat = {
    [Symbol.iterator]: () => requestCookies[Symbol.iterator](),
    delete: (...args: Parameters<ResponseCookiesType['delete']>) => {
      responseCookies.delete(...args);
      syncReadsWithWrites();
      return compat;
    },
    get: (...args: Parameters<RequestCookiesType['get']>) => requestCookies.get(...args),
    getAll: (...args: Parameters<RequestCookiesType['getAll']>) => requestCookies.getAll(...args),
    has: (name: string) => requestCookies.has(name),
    set: (...args: Parameters<ResponseCookiesType['set']>) => {
      responseCookies.set(...args);
      syncReadsWithWrites();
      return compat;
    },
    get size() {
      return requestCookies.size;
    },
    toString: () => requestCookies.toString(),
  };

  return compat as unknown as ReadonlyRequestCookies;
};

export const draftMode = async () => ({
  disable: () => {},
  enable: () => {},
  isEnabled: false,
});
