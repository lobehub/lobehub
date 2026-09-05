import { resolveAuthLocale } from '../lib/locale';
import { buildAuthMeta } from '../lib/seo';

export const meta = () => buildAuthMeta(resolveAuthLocale(), '/signup');

export { default } from '@/features/Auth/SignUp';
