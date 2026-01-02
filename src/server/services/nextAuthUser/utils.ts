import { type AdapterAuthenticator, type AdapterUser } from 'next-auth/adapters';

import { type NewUser } from '@/database/schemas';

export const mapAdapterUserToLobeUser = (adapterUser: AdapterUser): NewUser => {
  const { id, email, name, image, emailVerified } = adapterUser;
  return {
    avatar: image,
    email,
    emailVerifiedAt: emailVerified ? new Date(emailVerified) : undefined,
    fullName: name,
    id,
  };
};

export const partialMapAdapterUserToLobeUser = ({
  id,
  name,
  email,
  image,
  emailVerified,
}: Partial<AdapterUser>): Partial<NewUser> => {
  return {
    avatar: image,
    email,
    emailVerifiedAt: emailVerified ? new Date(emailVerified) : undefined,
    fullName: name,
    id,
  };
};

export const mapLobeUserToAdapterUser = (lobeUser: NewUser): AdapterUser => {
  const { id, fullName, email, avatar, emailVerifiedAt } = lobeUser;
  return {
    // In LobeUser, email is nullable
    email: email ?? '',
    emailVerified: emailVerifiedAt ? new Date(emailVerifiedAt) : null,
    id,
    image: avatar,
    name: fullName,
  };
};

type AuthenticatorQueryResult = {
  counter: number;
  credentialBackedUp: boolean;
  credentialDeviceType: string;
  credentialID: string;
  credentialPublicKey: string;
  providerAccountId: string;
  transports: string | null;
  userId: string;
};

export const mapAuthenticatorQueryResutlToAdapterAuthenticator = (
  authenticator: AuthenticatorQueryResult,
): AdapterAuthenticator => {
  return {
    ...authenticator,
    transports: authenticator?.transports ?? undefined,
  };
};
