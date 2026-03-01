import { SiDiscord } from '@icons-pack/react-simple-icons';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';

export interface IntegrationProvider {
  color: string;
  description: string;
  docsLink: string;
  fieldTags: {
    appId: string;
    publicKey?: string;
    token: string;
    webhook: string;
  };
  icon: ComponentType<any> | LucideIcon;
  id: string;
  name: string;
}

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    color: '#5865F2',
    description: 'Connect this assistant to Discord server for channel chat and direct messages.',
    docsLink: 'https://discord.com/developers/docs/intro',
    fieldTags: {
      appId: 'APPLICATION ID',
      publicKey: 'PUBLIC KEY',
      token: 'TOKEN',
      webhook: 'INTERACTIONS ENDPOINT URL',
    },
    icon: SiDiscord,
    id: 'discord',
    name: 'Discord',
  },
];
