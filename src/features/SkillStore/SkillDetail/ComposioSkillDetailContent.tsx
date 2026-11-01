'use client';


import { ComposioDetailProvider } from './ComposioDetailProvider';
import SkillDetailInner from './SkillDetailInner';

export interface ComposioSkillDetailContentProps {
  identifier: string;
  serverName: string;
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
