'use client';

import { type Klavis } from 'composio';

import { ComposioDetailProvider } from './ComposioDetailProvider';
import SkillDetailInner from './SkillDetailInner';

export interface ComposioSkillDetailContentProps {
  identifier: string;
  serverName: Klavis.McpServerName;
}

export const ComposioSkillDetailContent = ({
  identifier,
  serverName,
}: ComposioSkillDetailContentProps) => {
  return (
    <ComposioDetailProvider identifier={identifier} serverName={serverName}>
      <SkillDetailInner type="composio" />
    </ComposioDetailProvider>
  );
};
