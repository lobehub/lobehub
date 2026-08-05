import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { MailCheck, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AuthCard from '@/features/AuthCard';

export type SentEmailType = 'magicLink' | 'resetPassword';

export interface SignInEmailSentStepProps {
  email: string;
  onBack: () => void;
  onResend: () => Promise<void>;
  sending: boolean;
  type: SentEmailType;
}

export const SignInEmailSentStep = ({
  email,
  onBack,
  onResend,
  sending,
  type,
}: SignInEmailSentStepProps) => {
  const { t } = useTranslation('auth');

  const description =
    type === 'magicLink'
      ? t('betterAuth.signin.emailSent.magicLinkDescription', { email })
      : t('betterAuth.signin.emailSent.resetPasswordDescription', { email });

  return (
    <AuthCard
      subtitle={description}
      title={t('betterAuth.signin.emailSent.title')}
      footer={
        <Text align={'center'} fontSize={13} style={{ marginTop: 16 }} type={'secondary'}>
          <a
            role="button"
            style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            tabIndex={0}
            onClick={onBack}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onBack();
              }
            }}
          >
            {t('betterAuth.signin.emailSent.changeEmail')}
          </a>
        </Text>
      }
    >
      <Flexbox gap={16}>
        <Block horizontal align={'center'} gap={12} padding={16}>
          <Icon icon={MailCheck} size={20} />
          <Text type={'secondary'}>{t('betterAuth.signin.emailSent.checkSpam')}</Text>
        </Block>
        <Button
          block
          icon={<Icon icon={RefreshCw} size={16} />}
          loading={sending}
          size="large"
          onClick={onResend}
        >
          {t('betterAuth.signin.emailSent.resend')}
        </Button>
      </Flexbox>
    </AuthCard>
  );
};
