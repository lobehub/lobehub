import { auth } from '@/auth';

interface SetPasswordBody {
  newPassword?: string;
}

interface AuthApiErrorLike {
  body?: { message?: string };
  message?: string;
  status?: number;
  statusCode?: number;
}

const getErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Failed to set password';

  const typedError = error as AuthApiErrorLike;

  return typedError.body?.message || typedError.message || 'Failed to set password';
};

const getErrorStatus = (error: unknown) => {
  if (!error || typeof error !== 'object') return 400;

  const typedError = error as AuthApiErrorLike;

  if (typeof typedError.status === 'number') return typedError.status;
  if (typeof typedError.statusCode === 'number') return typedError.statusCode;

  return 400;
};

export const POST = async (req: Request) => {
  try {
    const body = (await req.json()) as SetPasswordBody;

    if (!body.newPassword || typeof body.newPassword !== 'string') {
      return Response.json({ message: 'newPassword is required' }, { status: 400 });
    }

    const result = await auth.api.setPassword({
      body: { newPassword: body.newPassword },
      headers: req.headers,
    });

    return Response.json(result);
  } catch (error) {
    console.error('Set password error:', error);

    return Response.json({ message: getErrorMessage(error) }, { status: getErrorStatus(error) });
  }
};
