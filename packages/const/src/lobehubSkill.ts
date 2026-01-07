import { type IconType, SiLinear } from '@icons-pack/react-simple-icons';

export interface LobehubSkillProviderType {
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
 * Predefined LobeHub Skill Provider list
 *
 * Note:
 * - This list is used for UI display (icons, labels)
 * - Actual availability depends on Market API response
 * - Add new providers here when Market adds support
 */
export const LOBEHUB_SKILL_PROVIDERS: LobehubSkillProviderType[] = [
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
export const getLobehubSkillProviderById = (id: string) =>
  LOBEHUB_SKILL_PROVIDERS.find((p) => p.id === id);

/**
 * Get all visible providers (for default UI display)
 */
export const getVisibleLobehubSkillProviders = () =>
  LOBEHUB_SKILL_PROVIDERS.filter((p) => p.defaultVisible !== false);
