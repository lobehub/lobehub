const CN_PHONE_REGEX = /^1[3-9]\d{9}$/;

const stripPhoneSeparators = (value: string) => value.replaceAll(/[\s()-]/g, '');

export const normalizeCnPhoneNumber = (value: string): string | null => {
  const trimmedValue = stripPhoneSeparators(value.trim());

  if (!trimmedValue) return null;

  if (trimmedValue.startsWith('+86')) {
    const localNumber = trimmedValue.slice(3);
    return CN_PHONE_REGEX.test(localNumber) ? `+86${localNumber}` : null;
  }

  if (trimmedValue.startsWith('86')) {
    const localNumber = trimmedValue.slice(2);
    return CN_PHONE_REGEX.test(localNumber) ? `+86${localNumber}` : null;
  }

  return CN_PHONE_REGEX.test(trimmedValue) ? `+86${trimmedValue}` : null;
};

export const isValidCnPhoneNumber = (value: string) => normalizeCnPhoneNumber(value) !== null;

export const buildPhoneTempEmail = (phoneNumber: string) => {
  const normalizedPhone = phoneNumber.replaceAll(/\D/g, '');

  return `phone-${normalizedPhone}@phone.local`;
};

export const toJiguangMobile = (phoneNumber: string) => {
  const normalizedPhone = normalizeCnPhoneNumber(phoneNumber);

  if (!normalizedPhone) return null;

  return normalizedPhone.slice(3);
};
