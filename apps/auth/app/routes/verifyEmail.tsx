import { resolveAuthLocale } from '../lib/locale';
import { buildAuthMeta } from '../lib/seo';

export const meta = () => buildAuthMeta(resolveAuthLocale(), '/verify-email');

export { default } from '@/features/Auth/VerifyEmail';
