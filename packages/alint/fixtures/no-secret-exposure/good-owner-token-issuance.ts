import { requireAuthenticatedUser, tokenService } from './auth';

// Intentional credential issuance to its authenticated owner.
export const issueToken = async (request: Request) => {
  const user = await requireAuthenticatedUser(request);
  const token = await tokenService.issue(user.id);
  return Response.json({ token });
};
