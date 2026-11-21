import { type CredType } from '@lobechat/types';
import { File, Globe, Key, type LucideIcon, TerminalSquare } from 'lucide-react';

/** One icon per credential type, shared by the vault rows and its create menu. */
export const CRED_TYPE_ICONS: Record<CredType, LucideIcon> = {
  'file': File,
  'kv-env': TerminalSquare,
  'kv-header': Globe,
  'oauth': Key,
};
