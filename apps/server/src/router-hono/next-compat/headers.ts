import type { SerializeOptions } from 'cookie';
import { parse, serialize } from 'cookie';

import { requireRequestContext } from './context';

export interface RequestCookie {
  name: string;
  value: string;
}

export type ResponseCookie = RequestCookie & SerializeOptions;

export const headers = async (): Promise<Headers> =>
  new Headers(requireRequestContext('headers').request.headers);

export const cookies = async () => {
  const { request, responseHeaders } = requireRequestContext('cookies');
  const store = new Map<string, string>();
  for (const [name, value] of Object.entries(parse(request.headers.get('cookie') ?? ''))) {
    if (value !== undefined) store.set(name, value);
  }

  const entries = (): RequestCookie[] => [...store].map(([name, value]) => ({ name, value }));

  const write = ({ name, value, ...options }: ResponseCookie) => {
    responseHeaders.append('set-cookie', serialize(name, value, { path: '/', ...options }));
    if (value === '') store.delete(name);
    else store.set(name, value);
    return compat;
  };

  const compat = {
    [Symbol.iterator]: () => {
      const pairs = entries().map((cookie) => [cookie.name, cookie] as const);
      return pairs[Symbol.iterator]();
    },
    delete: (cookie: string | Partial<ResponseCookie>) =>
      write({
        ...(typeof cookie === 'string' ? { name: cookie } : cookie),
        expires: new Date(0),
        name: typeof cookie === 'string' ? cookie : (cookie.name ?? ''),
        value: '',
      }),
    get: (name: string): RequestCookie | undefined =>
      store.has(name) ? { name, value: store.get(name)! } : undefined,
    getAll: (name?: string) =>
      name ? entries().filter((cookie) => cookie.name === name) : entries(),
    has: (name: string) => store.has(name),
    set: (cookie: string | ResponseCookie, value?: string, options?: SerializeOptions) =>
      write(typeof cookie === 'string' ? { name: cookie, value: value ?? '', ...options } : cookie),
    get size() {
      return store.size;
    },
    toString: () =>
      entries()
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; '),
  };

  return compat;
};

export const draftMode = async () => ({
  disable: () => {},
  enable: () => {},
  isEnabled: false,
});
