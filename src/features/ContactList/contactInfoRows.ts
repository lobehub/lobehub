export type ContactInfoRow =
  | { key: string; kind: 'handle'; value: string }
  | { key: string; kind: 'mail'; value: string }
  | { key: string; kind: 'bio'; value: string };

/**
 * The rows of a contact's info list, like the username, numbers and bio on a phone contact:
 * the handle, then every mail address the agent still owns, then its bio. A row the contact has
 * nothing for is left out rather than shown as "not set". The account read is scoped to the
 * caller, so another member's agent simply lists no mail rows.
 */
export const contactInfoRows = ({
  accounts,
  description,
  slug,
}: {
  accounts?: { id: string; identifier: string; kind: string; status: string }[];
  description?: string | null;
  slug?: string | null;
}): ContactInfoRow[] => {
  const rows: ContactInfoRow[] = [];
  if (slug) rows.push({ key: 'handle', kind: 'handle', value: `@${slug}` });

  for (const account of accounts ?? []) {
    if (account.kind === 'mail' && account.status !== 'revoked')
      rows.push({ key: account.id, kind: 'mail', value: account.identifier });
  }

  const bio = description?.trim();
  if (bio) rows.push({ key: 'bio', kind: 'bio', value: bio });

  return rows;
};
