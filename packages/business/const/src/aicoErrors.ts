/**
 * Aico standard business error codes.
 *
 * Server procedures should throw these codes (not free-form English). Clients
 * map them to localized copy via `aico:errors.*` — see the Aico technical
 * contract ("قرارداد خطای استاندارد").
 */
export const AICO_ERROR_CODES = [
  // Contract-required
  'BUDGET_EXCEEDED',
  'ORG_WALLET_EMPTY',
  'MODEL_NOT_ALLOWED',
  // Trial / phone
  'PHONE_VERIFICATION_REQUIRED',
  'TRIAL_DISABLED',
  'TRIAL_ALREADY_USED',
  'TRIAL_PHONE_BLOCKED',
  'TRIAL_PHONE_ALREADY_USED',
  'TRIAL_REQUEST_LIMIT',
  'TRIAL_KEY_UNAVAILABLE',
  'TRIAL_MODEL_NOT_ALLOWED',
  'TRIAL_FAILED',
  // Org / wallet / invite
  'ALREADY_HAS_ORGANIZATION',
  'ORG_NOT_FOUND',
  'ORG_NOT_ACTIVE',
  'INSUFFICIENT_ORG_BALANCE',
  'MEMBER_NOT_FOUND',
  'BUDGET_NOT_FOUND',
  'INVITE_NOT_FOUND',
  'INVITE_NOT_PENDING',
  'INVITE_EXPIRED',
  'INVITE_IDENTIFIER_MISMATCH',
  'TEAM_NOT_FOUND',
  'CANNOT_DELETE_DEFAULT_TEAM',
  'DEFAULT_TEAM_MISSING',
  // Keys / ops
  'MANAGED_KEY_UNAVAILABLE',
  'PERSONAL_FUNDS_UNAVAILABLE',
  'PERSONAL_WALLET_INACTIVE',
  'MEMBER_BUDGET_UNFUNDED',
  'MEMBER_BUDGET_INACTIVE',
  'MEMBER_BUDGET_RENEWAL_BLOCKED',
] as const;

export type AicoErrorCode = (typeof AICO_ERROR_CODES)[number];

const AICO_ERROR_CODE_SET = new Set<string>(AICO_ERROR_CODES);

/**
 * Codes that share another code's user-facing message.
 * e.g. DB throws INSUFFICIENT_ORG_BALANCE; UI shows ORG_WALLET_EMPTY copy.
 */
export const AICO_ERROR_ALIASES: Partial<Record<AicoErrorCode, AicoErrorCode>> = {
  INSUFFICIENT_ORG_BALANCE: 'ORG_WALLET_EMPTY',
};

/**
 * Persian defaults from the Aico contract — used when i18n is unavailable
 * (e.g. early boot) or as `defaultValue` for missing locale keys.
 */
export const AICO_ERROR_MESSAGES_FA: Record<AicoErrorCode, string> = {
  ALREADY_HAS_ORGANIZATION: 'شما از قبل یک سازمان دارید.',
  BUDGET_EXCEEDED: 'سهمیه‌ی شما تمام شده است.',
  BUDGET_NOT_FOUND: 'سهمیه یافت نشد.',
  CANNOT_DELETE_DEFAULT_TEAM: 'تیم پیش‌فرض را نمی‌توان حذف کرد.',
  DEFAULT_TEAM_MISSING: 'تیم پیش‌فرض سازمان یافت نشد.',
  INSUFFICIENT_ORG_BALANCE: 'موجودی کیف پول سازمان کافی نیست.',
  INVITE_EXPIRED: 'این دعوت‌نامه منقضی شده است.',
  INVITE_IDENTIFIER_MISMATCH: 'این دعوت‌نامه برای حساب دیگری صادر شده است.',
  INVITE_NOT_FOUND: 'دعوت‌نامه یافت نشد.',
  INVITE_NOT_PENDING: 'این دعوت‌نامه دیگر قابل پذیرش نیست.',
  MANAGED_KEY_UNAVAILABLE: 'کلید مدیریت‌شده در دسترس نیست. لطفاً بعداً تلاش کنید.',
  MEMBER_BUDGET_INACTIVE: 'سهمیه عضویت شما غیرفعال است.',
  MEMBER_BUDGET_RENEWAL_BLOCKED:
    'تمدید سهمیه عضویت در حال انجام یا ناموفق است؛ فعلاً نمی‌توانید چت کنید.',
  MEMBER_BUDGET_UNFUNDED: 'سهمیه سازمانی انتخاب‌شده موجودی ندارد.',
  MEMBER_NOT_FOUND: 'عضو یافت نشد.',
  MODEL_NOT_ALLOWED: 'دسترسی به این مدل برای شما فعال نیست.',
  ORG_NOT_ACTIVE: 'سازمان غیرفعال یا معلق است.',
  ORG_NOT_FOUND: 'سازمان یافت نشد.',
  ORG_WALLET_EMPTY: 'موجودی کیف پول سازمان کافی نیست.',
  PERSONAL_FUNDS_UNAVAILABLE:
    'موجودی کیف پول شخصی کافی نیست. لطفاً شارژ کنید یا دوره آزمایشی را فعال کنید.',
  PERSONAL_WALLET_INACTIVE: 'کیف پول شخصی شما غیرفعال است.',
  PHONE_VERIFICATION_REQUIRED: 'برای ادامه، ابتدا شماره موبایل خود را تأیید کنید.',
  TEAM_NOT_FOUND: 'تیم یافت نشد.',
  TRIAL_ALREADY_USED: 'دوره آزمایشی این حساب قبلاً استفاده شده است.',
  TRIAL_DISABLED: 'دوره آزمایشی در حال حاضر غیرفعال است.',
  TRIAL_FAILED: 'فعال‌سازی دوره آزمایشی ناموفق بود.',
  TRIAL_KEY_UNAVAILABLE: 'کلید دوره آزمایشی در دسترس نیست. لطفاً بعداً تلاش کنید.',
  TRIAL_MODEL_NOT_ALLOWED: 'این مدل در دوره آزمایشی مجاز نیست.',
  TRIAL_PHONE_ALREADY_USED: 'دوره آزمایشی با این شماره قبلاً استفاده شده است.',
  TRIAL_PHONE_BLOCKED: 'این شماره برای دوره آزمایشی مجاز نیست.',
  TRIAL_REQUEST_LIMIT: 'سقف درخواست‌های دوره آزمایشی تمام شده است.',
};

/** Strip suffixes like `MODEL_NOT_ALLOWED:gpt-4` → `MODEL_NOT_ALLOWED`. */
export const normalizeAicoErrorCode = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const colon = trimmed.indexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
};

export const isAicoErrorCode = (value: string): value is AicoErrorCode =>
  AICO_ERROR_CODE_SET.has(value);

export const resolveAicoErrorCode = (raw: string): AicoErrorCode | undefined => {
  const normalized = normalizeAicoErrorCode(raw);
  if (!isAicoErrorCode(normalized)) return undefined;
  return AICO_ERROR_ALIASES[normalized] ?? normalized;
};
