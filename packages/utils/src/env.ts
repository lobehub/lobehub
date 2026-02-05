export const isDev = process.env.NODE_ENV === 'development';

export const isOnServerSide = typeof window === 'undefined';
