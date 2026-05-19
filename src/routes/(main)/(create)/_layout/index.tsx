'use client';

import { Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';

import GenerationTypeSelector from '@/routes/(main)/(create)/features/GenerationLayout/GenerationTypeSelector';

interface CreateLayoutProps {
  children: ReactNode;
}

const CreateLayout = ({ children }: CreateLayoutProps) => {
  return (
    <Flexbox vertical height="100%">
      <GenerationTypeSelector />
      <Flexbox horizontal flex={1}>
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default CreateLayout;
