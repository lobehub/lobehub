export interface PlatformCredentialBodyProps {
  currentConfig?: {
    applicationId: string;
    credentials: Record<string, string>;
  };
  hasConfig?: boolean;
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => void;
}
