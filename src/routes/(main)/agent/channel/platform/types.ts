export interface PlatformCredentialBodyProps {
  currentConfig?: {
    applicationId: string;
    credentials: Record<string, string>;
  };
  disabled?: boolean;
  hasConfig?: boolean;
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => void;
}

export interface PlatformCredentialExtrasProps {
  disabled?: boolean;
}
