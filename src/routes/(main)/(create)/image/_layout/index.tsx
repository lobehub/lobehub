'use client';

import GenerationLayout from '@/routes/(main)/(create)/features/GenerationLayout';

import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';

const ImageLayout = () => <GenerationLayout extra={<RegisterHotkeys />} sidebar={<Sidebar />} />;

export default ImageLayout;
