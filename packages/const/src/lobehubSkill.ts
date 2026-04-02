import type { IconType } from '@icons-pack/react-simple-icons';
import { SiGithub, SiLinear, SiVercel, SiX } from '@icons-pack/react-simple-icons';

export interface LobehubSkillProviderType {
  /**
   * Author/Developer of the integration
   */
  author: string;
  /**
   * Author's website URL
   */
  authorUrl?: string;
  /**
   * Whether this provider is visible by default in the UI
   */
  defaultVisible?: boolean;
  /**
   * Short description of the skill
   */
  description: string;
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
  /**
   * Detailed readme of the skill
   */
  readme: string;
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
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    defaultVisible: true,
    description:
      'GitHub is a platform for version control and collaboration, enabling developers to host, review, and manage code repositories.',
    icon: SiGithub,
    id: 'github',
    label: 'GitHub',
    readme:
      'Connect to GitHub to access your repositories, create and manage issues, review pull requests, and collaborate on code—all through natural conversation with your AI assistant.',
  },
  {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    defaultVisible: true,
    description:
      'Linear is a modern issue tracking and project management tool designed for high-performance teams to build better software faster',
    icon: SiLinear,
    id: 'linear',
    readme:
      'Bring the power of Linear directly into your AI assistant. Create and update issues, manage sprints, track project progress, and streamline your development workflow—all through natural conversation.',
    label: 'Linear',
  },
  {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    defaultVisible: true,
    description:
      'Outlook Calendar is an integrated scheduling tool within Microsoft Outlook that enables users to create appointments, organize meetings with others, and manage their time and events effectively.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/outlook.svg',
    id: 'microsoft',
    readme:
      'Integrate with Outlook Calendar to view, create, and manage your events seamlessly. Schedule meetings, check availability, set reminders, and coordinate your time—all through natural language commands.',
    label: 'Outlook Calendar',
  },
  {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    defaultVisible: true,
    description:
      'X (Twitter) is a social media platform for sharing real-time updates, news, and engaging with your audience through posts, replies, and direct messages.',
    icon: SiX,
    id: 'twitter',
    readme:
      'Connect to X (Twitter) to post tweets, manage your timeline, and engage with your audience. Create content, schedule posts, monitor mentions, and build your social media presence through conversational AI.',
    label: 'X (Twitter)',
  },
  {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    defaultVisible: true,
    description:
      'Vercel is a cloud platform for frontend developers, providing hosting and serverless functions to deploy web applications with ease.',
    icon: SiVercel,
    id: 'vercel',
    readme:
      'Connect to Vercel to manage your deployments, monitor project status, and control your infrastructure. Deploy applications, check build logs, manage environment variables, and scale your projects through conversational AI.',
    label: 'Vercel',
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
