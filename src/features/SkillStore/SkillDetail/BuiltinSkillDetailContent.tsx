'use client';

import { BuiltinDetailProvider } from './BuiltinDetailProvider';
import SkillDetailInner from './SkillDetailInner';

export interface BuiltinSkillDetailContentProps {
  identifier: string;
}

export const BuiltinSkillDetailContent = ({ identifier }: BuiltinSkillDetailContentProps) => {
  return (
    <BuiltinDetailProvider identifier={identifier}>
      <SkillDetailInner type="builtin" />
    </BuiltinDetailProvider>
  );
};
