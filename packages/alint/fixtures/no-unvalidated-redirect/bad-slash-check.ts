export const finishLogin = (input: { returnTo: string }) => {
  if (!input.returnTo.startsWith('/')) throw new Error('Local path required');
  // alint-expect
  window.location.assign(input.returnTo);
};
