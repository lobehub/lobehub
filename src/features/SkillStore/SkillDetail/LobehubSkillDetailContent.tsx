'use client';

import { LobehubDetailProvider } from './LobehubDetailProvider';
import SkillDetailInner from './SkillDetailInner';

export interface LobehubSkillDetailContentProps {
  identifier: string;
}

export const LobehubSkillDetailContent = ({ identifier }: LobehubSkillDetailContentProps) => {
  return (
    <LobehubDetailProvider identifier={identifier}>
      <SkillDetailInner type="lobehub" />
    </LobehubDetailProvider>
  );
};
