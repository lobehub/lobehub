'use client';

import { type Klavis } from 'klavis';

import { KlavisDetailProvider } from './KlavisDetailProvider';
import SkillDetailInner from './SkillDetailInner';

export interface KlavisSkillDetailContentProps {
  identifier: string;
  serverName: Klavis.McpServerName;
}

export const KlavisSkillDetailContent = ({
  identifier,
  serverName,
}: KlavisSkillDetailContentProps) => {
  return (
    <KlavisDetailProvider identifier={identifier} serverName={serverName}>
      <SkillDetailInner type="klavis" />
    </KlavisDetailProvider>
  );
};
