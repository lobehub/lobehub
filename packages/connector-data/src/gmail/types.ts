export interface GmailAccount {
  email?: string;
  externalAccountId: string;
  scopes: string[];
}

export interface GmailMessage {
  bodyPreview?: string;
  date?: string;
  id: string;
  labels: string[];
  recipient?: string;
  sender?: string;
  snippet?: string;
  sourceUrl?: string;
  subject: string;
}
