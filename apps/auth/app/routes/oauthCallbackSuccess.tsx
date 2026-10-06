import { resolveAuthLocale } from '../lib/locale';
import { buildAuthMeta } from '../lib/seo';

export const meta = () => buildAuthMeta(resolveAuthLocale(), '/oauth/callback/success');

export { default } from '@/features/Auth/OAuthCallback/Success';
