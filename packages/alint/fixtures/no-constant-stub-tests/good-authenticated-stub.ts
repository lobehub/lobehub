import { expect, it } from 'vitest';

const disabledEndpoint = () => ({ status: 410 });
const request = (token?: string) => {
  if (token !== 'owner-token') return { status: 401 };
  return disabledEndpoint();
};

it('checks authentication before reaching the disabled endpoint', () => {
  expect(request()).toEqual({ status: 401 });
  expect(request('owner-token')).toEqual({ status: 410 });
});
