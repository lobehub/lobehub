import { verifyToken } from './auth';

export const authenticate = async (token: string) => {
  try {
    return await verifyToken(token);
  } catch (error) {
    console.error('Token validation failed', error);
    throw error;
  }
};
