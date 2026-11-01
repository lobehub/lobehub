export const callback = (request: Request) => {
  const origin = 'https://app.example.com';
  const raw = new URL(request.url).searchParams.get('returnTo') ?? '/';
  const target = new URL(raw, origin);
  if (target.origin !== origin) throw new Error('Untrusted redirect');
  return Response.redirect(target);
};
