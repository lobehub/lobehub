import type { IFeatureFlags } from '@/config/featureFlags';
import type { GlobalServerConfig } from '@/types/serverConfig';

export interface AnalyticsConfig {
  clarity?: { projectId: string };
  desktop?: { baseUrl: string; projectId: string };
  google?: { measurementId: string };
  plausible?: { domain: string; scriptBaseUrl: string };
  posthog?: { debug: boolean; host: string; key: string };
  reactScan?: { apiKey: string };
  umami?: { scriptUrl: string; websiteId: string };
  vercel?: { debug: boolean; enabled: boolean };
}

export interface SPAClientEnv {
  marketBaseUrl?: string;
  pyodideIndexUrl?: string;
  pyodidePipIndexUrl?: string;
  s3FilePath?: string;
}

export interface SPAServerConfig {
  analyticsConfig: AnalyticsConfig;
  clientEnv: SPAClientEnv;
  config: GlobalServerConfig;
  featureFlags: Partial<IFeatureFlags>;
  isMobile: boolean;
}
