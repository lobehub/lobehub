import { expect, it } from 'vitest';

const retiredEndpoint = () => {
  throw new Error('Disabled');
};
const respond = (handler: () => void) => {
  try {
    handler();
    return { status: 200 };
  } catch (error) {
    return { status: error instanceof Error && error.message === 'Disabled' ? 410 : 500 };
  }
};

it('maps retired endpoint errors into the client protocol', () => {
  expect(respond(retiredEndpoint)).toEqual({ status: 410 });
  expect(
    respond(() => {
      throw new Error('Unexpected');
    }),
  ).toEqual({ status: 500 });
});
