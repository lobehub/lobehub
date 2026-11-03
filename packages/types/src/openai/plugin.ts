type HttpAuthorizationType = 'bearer' | 'basic';

interface BaseManifestAuth {
  instructions: string;
  type: string;
}

interface ManifestNoAuth extends BaseManifestAuth {
  type: 'none';
}

interface ManifestServiceHttpAuth extends BaseManifestAuth {
  authorization_type: HttpAuthorizationType;
  type: 'service_http';
  verification_tokens: {
    [service: string]: string;
  };
}

interface ManifestUserHttpAuth extends BaseManifestAuth {
  authorization_type: HttpAuthorizationType;
  type: 'user_http';
}

interface ManifestOAuthAuth extends BaseManifestAuth {
  authorization_content_type: string;
  authorization_url: string;
  client_url: string;
  scope: string;
  type: 'oauth';
  verification_tokens: {
    [service: string]: string;
  };
}

type ManifestAuth =
  | ManifestNoAuth
  | ManifestServiceHttpAuth
  | ManifestUserHttpAuth
  | ManifestOAuthAuth;

export interface OpenAIPluginManifest {
  api: {
    type: string;
    url: string;
  };
  auth: ManifestAuth;
  contact_email: string;
  description_for_human: string;
  description_for_model: string;
  legal_info_url: string;
  logo_url: string;
  name_for_human: string;
  name_for_model: string;
  schema_version: string;
  // Other possible fields...
}
