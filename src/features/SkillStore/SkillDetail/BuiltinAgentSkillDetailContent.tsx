'use client';

import { BuiltinAgentSkillDetailProvider } from './BuiltinAgentSkillDetailProvider';
import SkillDetailInner from './SkillDetailInner';

export interface BuiltinAgentSkillDetailContentProps {
  identifier: string;
}

export const BuiltinAgentSkillDetailContent = ({
  identifier,
}: BuiltinAgentSkillDetailContentProps) => {
  return (
    <BuiltinAgentSkillDetailProvider identifier={identifier}>
      <SkillDetailInner type="builtin" />
    </BuiltinAgentSkillDetailProvider>
  );
};
