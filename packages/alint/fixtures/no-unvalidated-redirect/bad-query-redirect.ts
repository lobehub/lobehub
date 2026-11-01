export const callback = (request: Request) => {
  const target = new URL(request.url).searchParams.get('returnTo')!;
  // alint-expect
  return Response.redirect(target);
};
