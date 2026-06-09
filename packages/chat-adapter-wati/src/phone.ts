export const normalizePhoneDigits = (phone: string): string => phone.replaceAll(/\D/g, '');

export interface WatiWhatsAppPhoneEntry {
  channelPhoneNumber?: string;
  displayPhoneNumber?: string;
  phoneId?: string;
  phoneNumber?: string;
}

/** Prefer the display string Wati uses for webhookEndpoints `phoneNumber`. */
export const pickWebhookPhoneValue = (entry: WatiWhatsAppPhoneEntry): string =>
  entry.displayPhoneNumber?.trim() ||
  entry.channelPhoneNumber?.trim() ||
  entry.phoneNumber?.trim() ||
  '';

/**
 * Map configured digits to the exact phone identifier Wati expects for webhooks.
 * Throws when multiple numbers exist and none match.
 */
export const resolveWebhookPhoneNumber = (
  configuredDigits: string,
  entries: WatiWhatsAppPhoneEntry[],
): string => {
  const target = normalizePhoneDigits(configuredDigits);

  if (entries.length === 0) {
    return target;
  }

  const exact = entries.find((entry) => {
    const candidates = [pickWebhookPhoneValue(entry), entry.phoneId].filter(Boolean) as string[];
    return candidates.some((value) => normalizePhoneDigits(value) === target);
  });
  if (exact) return pickWebhookPhoneValue(exact);

  if (entries.length === 1) {
    const only = entries[0]!;
    const onlyValue = pickWebhookPhoneValue(only);
    const onlyDigits = normalizePhoneDigits(onlyValue);
    if (
      !target ||
      onlyDigits === target ||
      onlyDigits.endsWith(target) ||
      target.endsWith(onlyDigits)
    ) {
      return onlyValue;
    }
  }

  const available = entries.map(pickWebhookPhoneValue).filter(Boolean).join(', ');
  throw new Error(
    `No Wati WhatsApp number matches "${configuredDigits}". ` +
      `Numbers on your Wati account: ${available || '(none)'}`,
  );
};

export const extractPhoneListFromResponse = (json: unknown): WatiWhatsAppPhoneEntry[] => {
  if (!json || typeof json !== 'object') return [];
  const record = json as Record<string, unknown>;
  const raw = record.result ?? record.phoneNumbers ?? record.numbers ?? record.data;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object') as WatiWhatsAppPhoneEntry[];
};
