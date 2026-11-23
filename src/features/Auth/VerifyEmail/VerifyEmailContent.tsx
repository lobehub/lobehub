import { Block, Button, Flexbox, Text } from '@lobehub/ui';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';

import { useVerifyEmail } from './useVerifyEmail';

interface VerifyEmailContentProps {
  callbackUrl: string;
  email: string | null;
}

export const VerifyEmailContent = ({ email, callbackUrl }: VerifyEmailContentProps) => {
  const { t } = useTranslation('auth');
  const { handleResendEmail, resendError, resending } = useVerifyEmail({ callbackUrl, email });

  return (
    <Flexbox gap={16}>
      <Block padding={24}>
        <Text align={'center'}>{t('betterAuth.verifyEmail.checkSpam')}</Text>
      </Block>
      <Button
        icon={<RefreshCw size={16} />}
        loading={resending}
        size="large"
        type="default"
        onClick={handleResendEmail}
      >
        {t('betterAuth.verifyEmail.resend.button')}
      </Button>
      {resendError && <InlineErrorText>{resendError}</InlineErrorText>}
    </Flexbox>
  );
};
