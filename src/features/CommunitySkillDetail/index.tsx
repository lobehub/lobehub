'use client';

import { createModal } from '@lobehub/ui/base-ui';

import { SkillDetailContent } from './SkillDetailContent';

export { SkillDetailContent, SkillDetailView } from './SkillDetailContent';
export { SkillNavKey } from './types';

export interface CreateSkillDetailModalOptions {
  identifier: string;
}

export const createSkillDetailModal = ({ identifier }: CreateSkillDetailModalOptions) =>
  createModal({
    content: <SkillDetailContent identifier={identifier} />,
    footer: null,
    styles: {
      content: {
        maxHeight: 'calc(100dvh - 160px)',
        overflowY: 'auto',
        paddingBlock: 24,
        paddingInline: 'clamp(16px, 4vw, 40px)',
      },
    },
    title: null,
    width: 'min(92vw, 960px)',
  });
