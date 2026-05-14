export interface WhatsAppAdapterConfig {
  accessToken: string;
  apiBaseUrl?: string;
  appSecret: string;
  graphApiVersion?: string;
  phoneNumberId: string;
  verifyToken: string;
}

export interface WhatsAppThreadId {
  id: string;
  type: 'user';
}

export interface WhatsAppContact {
  profile?: {
    name?: string;
  };
  wa_id: string;
}

export interface WhatsAppMediaObject {
  caption?: string;
  filename?: string;
  id: string;
  mime_type?: string;
  sha256?: string;
}

export interface WhatsAppLocationObject {
  address?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
}

export interface WhatsAppMessage {
  audio?: WhatsAppMediaObject;
  button?: {
    payload?: string;
    text?: string;
  };
  context?: {
    from?: string;
    id?: string;
  };
  document?: WhatsAppMediaObject;
  from: string;
  id: string;
  image?: WhatsAppMediaObject;
  interactive?: {
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      description?: string;
      id?: string;
      title?: string;
    };
    type?: string;
  };
  location?: WhatsAppLocationObject;
  sticker?: WhatsAppMediaObject;
  text?: {
    body?: string;
  };
  timestamp?: string;
  type: string;
  video?: WhatsAppMediaObject;
}

export interface WhatsAppWebhookValue {
  contacts?: WhatsAppContact[];
  errors?: Array<Record<string, unknown>>;
  messages?: WhatsAppMessage[];
  messaging_product?: 'whatsapp';
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  statuses?: Array<Record<string, unknown>>;
}

export interface WhatsAppWebhookChange {
  field: string;
  value: WhatsAppWebhookValue;
}

export interface WhatsAppWebhookEntry {
  changes?: WhatsAppWebhookChange[];
  id: string;
}

export interface WhatsAppWebhookPayload {
  entry?: WhatsAppWebhookEntry[];
  object?: string;
}

export interface WhatsAppApiError {
  error?: {
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    message?: string;
    type?: string;
  };
}

export interface WhatsAppPhoneNumberInfo {
  code_verification_status?: string;
  display_phone_number?: string;
  id?: string;
  name_status?: string;
  platform_type?: string;
  quality_rating?: string;
  verified_name?: string;
}

export interface WhatsAppMediaInfo {
  file_size?: number;
  id?: string;
  messaging_product?: string;
  mime_type?: string;
  sha256?: string;
  url?: string;
}

export interface WhatsAppSendMessageResponse {
  contacts?: Array<{
    input?: string;
    wa_id?: string;
  }>;
  messages?: Array<{
    id?: string;
  }>;
  messaging_product?: string;
}
