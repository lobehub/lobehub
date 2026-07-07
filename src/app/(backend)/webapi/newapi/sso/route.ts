import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { serverDB } from '@/database/server';
import { NewApiAccountService } from '@/server/services/newapiAccount';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user?.id) {
    const signInUrl = new URL('/login', request.url);
    signInUrl.searchParams.set('callbackUrl', new URL(request.url).pathname);

    return NextResponse.redirect(signInUrl);
  }

  try {
    const redirectUrl = await new NewApiAccountService(serverDB).createSsoRedirectUrl({
      email: session.user.email,
      id: session.user.id,
      username: session.user.username as string | null | undefined,
    });

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('[newapi:sso]', error);

    return NextResponse.json({ error: 'Failed to create NewAPI login session' }, { status: 500 });
  }
}
