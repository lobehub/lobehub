import { type IconType, SiLinear } from '@icons-pack/react-simple-icons';

export interface MarketConnectProviderType {
  /**
   * Whether this provider is visible by default in the UI
   */
  defaultVisible?: boolean;
  /**
   * Icon - can be a URL string or a React icon component
   */
  icon: string | IconType;
  /**
   * Provider ID (matches Market API, e.g., 'linear', 'microsoft')
   */
  id: string;
  /**
   * Display label for the provider
   */
  label: string;
}

/**
 * Predefined Market Connect Provider list
 *
 * Note:
 * - This list is used for UI display (icons, labels)
 * - Actual availability depends on Market API response
 * - Add new providers here when Market adds support
 */
export const MARKET_CONNECT_PROVIDERS: MarketConnectProviderType[] = [
  {
    defaultVisible: true,
    icon: SiLinear,
    id: 'linear',
    label: 'Linear',
  },
  {
    defaultVisible: true,
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/outlook.svg',
    id: 'microsoft',
    label: 'Outlook Calendar',
  },
];

/**
 * Get provider config by ID
 */
export const getMarketConnectProviderById = (id: string) =>
  MARKET_CONNECT_PROVIDERS.find((p) => p.id === id);

/**
 * Get all visible providers (for default UI display)
 */
export const getVisibleMarketConnectProviders = () =>
  MARKET_CONNECT_PROVIDERS.filter((p) => p.defaultVisible !== false);
