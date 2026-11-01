'use client';

import GenerationLayout from '@/routes/(main)/(create)/features/GenerationLayout';
import { useImageStore } from '@/store/image';

import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';

const ImageLayout = () => (
  <GenerationLayout extra={<RegisterHotkeys />} sidebar={<Sidebar />} useStore={useImageStore} />
);

export default ImageLayout;
