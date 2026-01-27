import { containsChinese } from '@lobechat/utils';
import { Checkbox } from '@lobehub/ui';
import { App } from 'antd';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const shouldShowChineseWarning = (
  model: string,
  prompt: string,
  hasWarningBeenDismissed: boolean,
): boolean => {
  return (
    model.includes('gemini-2.5-flash-image-preview') &&
    !hasWarningBeenDismissed &&
    Boolean(prompt) &&
    containsChinese(prompt)
  );
};

interface UseGeminiChineseWarningOptions {
  model: string;
  prompt: string;
  scenario?: 'chat' | 'image';
}

export const useGeminiChineseWarning = () => {
  const { t } = useTranslation('common');
  const { modal } = App.useApp();

  const [hideGeminiChineseWarning, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.systemStatus(s).hideGemini2_5FlashImagePreviewChineseWarning ?? false,
    s.updateSystemStatus,
  ]);

  const checkWarning = useCallback(
    async ({
      model,
      prompt,
      scenario = 'chat',
    }: UseGeminiChineseWarningOptions): Promise<boolean> => {
      if (!shouldShowChineseWarning(model, prompt, hideGeminiChineseWarning)) {
        return true;
      }

      return new Promise<boolean>((resolve) => {
        let doNotShowAgain = false;

        // Select different button text based on scenario
        const continueText =
          scenario === 'image'
            ? t('geminiImageChineseWarning.continueGenerate')
            : t('geminiImageChineseWarning.continueSend');

        modal.confirm({
          cancelText: t('cancel', { ns: 'common' }),
          centered: true,
          content: (
            <div>
              <p>{t('geminiImageChineseWarning.content')}</p>
              <div style={{ marginTop: 16 }}>
                <Checkbox
                  onChange={(v) => {
                    doNotShowAgain = v;
                  }}
                >
                  {t('geminiImageChineseWarning.doNotShowAgain')}
                </Checkbox>
              </div>
            </div>
          ),
          okText: continueText,
          onCancel: () => {
            resolve(false);
          },
          onOk: () => {
            if (doNotShowAgain) {
              updateSystemStatus({ hideGemini2_5FlashImagePreviewChineseWarning: true });
            }
            resolve(true);
          },
          title: t('geminiImageChineseWarning.title'),
        });
      });
    },
    [modal, t, hideGeminiChineseWarning, updateSystemStatus],
  );

  return checkWarning;
};
