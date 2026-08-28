export type LobeEnv = NonNullable<Window['lobeEnv']>;

export const getLobeEnv = (): LobeEnv | undefined => window.lobeEnv;

export const isDarwinDesktop = (): boolean => getLobeEnv()?.platform === 'darwin';
