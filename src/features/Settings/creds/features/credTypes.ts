import { type CredType } from '@lobechat/types';
import { File, Globe, Key, type LucideIcon, TerminalSquare } from 'lucide-react';

/** Every credential type, in the order the create menu and the type filter list them. */
export const CRED_TYPES: CredType[] = ['kv-env', 'kv-header', 'oauth', 'file'];

export const CRED_TYPE_ICONS: Record<CredType, LucideIcon> = {
  'file': File,
  'kv-env': TerminalSquare,
  'kv-header': Globe,
  'oauth': Key,
};
