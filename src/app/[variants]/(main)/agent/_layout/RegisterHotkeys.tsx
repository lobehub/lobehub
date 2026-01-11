'use client';

import { memo } from 'react';

import { useRegisterChatHotkeys } from '@/hooks/useHotkeys';

const RegisterHotkeys = memo(() => {
  useRegisterChatHotkeys();

  return '';
});

export default RegisterHotkeys;
