/**
 * Contracted Better Auth session.user shape (Aico Phase 1 deliverable).
 * Consumers in Phase 4 / 5.5 should depend on this type, not ad-hoc fields.
 */
export interface AicoSessionUser {
  email: string | null;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string | null;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
}

/**
 * Map a Better Auth session user (or partial) onto the Aico contract.
 */
export const toAicoSessionUser = (
  user:
    | {
        email?: string | null;
        emailVerified?: boolean | null;
        id: string;
        image?: string | null;
        name?: string | null;
        phoneNumber?: string | null;
        phoneNumberVerified?: boolean | null;
      }
    | null
    | undefined,
): AicoSessionUser | null => {
  if (!user) return null;

  // Phone OTP signup uses getTempName: () => '' so the onboarding name
  // prompt stays blank — treat empty / whitespace as null for consumers.
  const name = user.name?.trim() ? user.name : null;

  return {
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerified),
    id: user.id,
    image: user.image ?? null,
    name,
    phoneNumber: user.phoneNumber ?? null,
    phoneNumberVerified: Boolean(user.phoneNumberVerified),
  };
};
