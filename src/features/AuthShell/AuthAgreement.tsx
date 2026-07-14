'use client';

import { Text } from '@lobehub/ui';
import { Checkbox, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { PRIVACY_URL, TERMS_URL } from '@/const/url';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    cursor: pointer;
    color: inherit;
    text-decoration: underline;

    &:active,
    &:focus,
    &:hover,
    &:visited {
      text-decoration: underline;
    }

    &:visited {
      color: ${cssVar.colorLinkActive};
    }
  `,
}));

type AuthAgreementProps =
  | {
      checked: boolean;
      onChange: (checked: boolean) => void;
    }
  | {
      checked?: undefined;
      onChange?: undefined;
    };

interface AgreementTextProps {
  i18nKey: 'agreement.checkbox' | 'agreement.confirm.content' | 'footer.agreement';
}

type ContinueWithAgreement = () => void;
type RequestAgreementConfirmation = (onConfirm: ContinueWithAgreement) => void;

const AgreementText = memo<AgreementTextProps>(({ i18nKey }) => {
  const { t: translate } = useTranslation('auth');

  return (
    <Trans
      i18nKey={i18nKey}
      ns={'auth'}
      components={{
        privacy: (
          <a className={styles.link} href={PRIVACY_URL} rel="noopener noreferrer" target="_blank">
            {translate('footer.privacy')}
          </a>
        ),
        terms: (
          <a className={styles.link} href={TERMS_URL} rel="noopener noreferrer" target="_blank">
            {translate('footer.terms')}
          </a>
        ),
      }}
    />
  );
});

export const useAuthAgreement = (requestConfirmation?: RequestAgreementConfirmation) => {
  const { t } = useTranslation(['auth', 'common']);
  const [agreementChecked, setAgreementChecked] = useState(false);

  const showConfirmation = useCallback(
    (onConfirm: ContinueWithAgreement) => {
      if (requestConfirmation) {
        requestConfirmation(onConfirm);
        return;
      }

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: <AgreementText i18nKey={'agreement.confirm.content'} />,
        okText: t('agreement.confirm.ok', { ns: 'auth' }),
        onOk: onConfirm,
        title: t('agreement.confirm.title', { ns: 'auth' }),
      });
    },
    [requestConfirmation, t],
  );

  const continueWithAgreement = useCallback(
    (continueAction: ContinueWithAgreement) => {
      if (agreementChecked) {
        continueAction();
        return;
      }

      showConfirmation(() => {
        setAgreementChecked(true);
        continueAction();
      });
    },
    [agreementChecked, showConfirmation],
  );

  return { agreementChecked, continueWithAgreement, setAgreementChecked };
};

const AuthAgreement = memo<AuthAgreementProps>(({ checked, onChange }) => {
  if (checked === undefined || onChange === undefined) {
    return (
      <Text fontSize={13} style={{ display: 'block', marginBlockStart: 8 }} type={'secondary'}>
        <AgreementText i18nKey={'footer.agreement'} />
      </Text>
    );
  }

  return (
    <Checkbox
      checked={checked}
      size={16}
      style={{ alignItems: 'flex-start', marginBlockEnd: 12, width: '100%' }}
      styles={{ checkbox: { marginBlockStart: 2 } }}
      textProps={{ fontSize: 13, type: 'secondary' }}
      onChange={onChange}
    >
      <AgreementText i18nKey={'agreement.checkbox'} />
    </Checkbox>
  );
});

export default AuthAgreement;
