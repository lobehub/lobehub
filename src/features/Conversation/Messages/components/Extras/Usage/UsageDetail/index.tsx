import { type ModelPerformance, type ModelUsage } from '@lobechat/types';
import { Center, Flexbox, Icon, Popover } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { BadgeCent, CoinsIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { formatNumber, formatShortenNumber } from '@/utils/format';

import AnimatedNumber from './AnimatedNumber';
import ModelCard from './ModelCard';
import { type TokenProgressItem } from './TokenProgress';
import TokenProgress from './TokenProgress';
import { getDetailsToken } from './tokens';

interface TokenDetailProps {
  model: string;
  performance?: ModelPerformance;
  provider: string;
  usage: ModelUsage;
}

const TokenDetail = memo<TokenDetailProps>(({ usage, performance, model, provider }) => {
  const { t } = useTranslation('chat');

  // 使用 systemStatus 管理短格式显示状态
  const isShortFormat = useGlobalStore(systemStatusSelectors.tokenDisplayFormatShort);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const modelCard = useAiInfraStore(aiModelSelectors.getModelCard(model, provider));
  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit) && !!modelCard?.pricing;

  const detailTokens = getDetailsToken(usage, modelCard);
  const inputDetails = [
    !!detailTokens.inputAudio && {
      color: cssVar.cyan9,
      id: 'reasoning',
      title: t('messages.tokenDetails.inputAudio'),
      value: isShowCredit ? detailTokens.inputAudio.credit : detailTokens.inputAudio.token,
    },
    !!detailTokens.inputCitation && {
      color: cssVar.orange,
      id: 'inputText',
      title: t('messages.tokenDetails.inputCitation'),
      value: isShowCredit ? detailTokens.inputCitation.credit : detailTokens.inputCitation.token,
    },
    !!detailTokens.inputText && {
      color: cssVar.green,
      id: 'inputText',
      title: t('messages.tokenDetails.inputText'),
      value: isShowCredit ? detailTokens.inputText.credit : detailTokens.inputText.token,
    },
  ].filter(Boolean) as TokenProgressItem[];

  const outputDetails = [
    !!detailTokens.outputReasoning && {
      color: cssVar.pink,
      id: 'reasoning',
      title: t('messages.tokenDetails.reasoning'),
      value: isShowCredit
        ? detailTokens.outputReasoning.credit
        : detailTokens.outputReasoning.token,
    },
    !!detailTokens.outputImage && {
      color: cssVar.purple,
      id: 'outputImage',
      title: t('messages.tokenDetails.outputImage'),
      value: isShowCredit ? detailTokens.outputImage.credit : detailTokens.outputImage.token,
    },
    !!detailTokens.outputAudio && {
      color: cssVar.cyan9,
      id: 'outputAudio',
      title: t('messages.tokenDetails.outputAudio'),
      value: isShowCredit ? detailTokens.outputAudio.credit : detailTokens.outputAudio.token,
    },
    !!detailTokens.outputText && {
      color: cssVar.green,
      id: 'outputText',
      title: t('messages.tokenDetails.outputText'),
      value: isShowCredit ? detailTokens.outputText.credit : detailTokens.outputText.token,
    },
  ].filter(Boolean) as TokenProgressItem[];

  const totalDetail = [
    !!detailTokens.inputCacheMiss && {
      color: cssVar.colorFill,

      id: 'uncachedInput',
      title: t('messages.tokenDetails.inputUncached'),
      value: isShowCredit ? detailTokens.inputCacheMiss.credit : detailTokens.inputCacheMiss.token,
    },
    !!detailTokens.inputCached && {
      color: cssVar.orange,
      id: 'inputCached',
      title: t('messages.tokenDetails.inputCached'),
      value: isShowCredit ? detailTokens.inputCached.credit : detailTokens.inputCached.token,
    },
    !!detailTokens.inputCachedWrite && {
      color: cssVar.yellow,
      id: 'cachedWriteInput',
      title: t('messages.tokenDetails.inputWriteCached'),
      value: isShowCredit
        ? detailTokens.inputCachedWrite.credit
        : detailTokens.inputCachedWrite.token,
    },
    !!detailTokens.totalOutput && {
      color: cssVar.colorSuccess,
      id: 'output',
      title: t('messages.tokenDetails.output'),
      value: isShowCredit ? detailTokens.totalOutput.credit : detailTokens.totalOutput.token,
    },
  ].filter(Boolean) as TokenProgressItem[];

  const totalCount =
    isShowCredit && !!detailTokens.totalTokens
      ? detailTokens.totalTokens.credit
      : detailTokens.totalTokens!.token;

  const detailTotal = formatNumber(totalCount);

  const averagePricing = formatNumber(
    detailTokens.totalTokens!.credit / detailTokens.totalTokens!.token,
    2,
  );

  const tps = performance?.tps ? formatNumber(performance.tps, 2) : undefined;
  const ttft = performance?.ttft ? formatNumber(performance.ttft / 1000, 2) : undefined;

  return (
    <Popover
      placement={'top'}
      trigger="hover"
      content={
        <Flexbox gap={8} style={{ minWidth: 200 }}>
          {modelCard && <ModelCard {...modelCard} provider={provider} />}

          <Flexbox gap={20}>
            {inputDetails.length > 1 && (
              <Flexbox gap={4}>
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={4}
                  justify={'space-between'}
                  width={'100%'}
                >
                  <div style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
                    {t('messages.tokenDetails.inputTitle')}
                  </div>
                </Flexbox>
                <TokenProgress showIcon data={inputDetails} />
              </Flexbox>
            )}
            {outputDetails.length > 1 && (
              <Flexbox gap={4}>
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={4}
                  justify={'space-between'}
                  width={'100%'}
                >
                  <div style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
                    {t('messages.tokenDetails.outputTitle')}
                  </div>
                </Flexbox>
                <TokenProgress showIcon data={outputDetails} />
              </Flexbox>
            )}
            <Flexbox>
              <TokenProgress showIcon data={totalDetail} />
              <Divider style={{ marginBlock: 8 }} />
              <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
                <div style={{ color: cssVar.colorTextSecondary }}>
                  {t('messages.tokenDetails.total')}
                </div>
                <div style={{ fontWeight: 500 }}>{detailTotal}</div>
              </Flexbox>
              {isShowCredit && (
                <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
                  <div style={{ color: cssVar.colorTextSecondary }}>
                    {t('messages.tokenDetails.average')}
                  </div>
                  <div style={{ fontWeight: 500 }}>{averagePricing}</div>
                </Flexbox>
              )}
              {tps && (
                <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
                  <Flexbox horizontal gap={8}>
                    <div style={{ color: cssVar.colorTextSecondary }}>
                      {t('messages.tokenDetails.speed.tps.title')}
                    </div>
                    <InfoTooltip title={t('messages.tokenDetails.speed.tps.tooltip')} />
                  </Flexbox>
                  <div style={{ fontWeight: 500 }}>{tps}</div>
                </Flexbox>
              )}
              {ttft && (
                <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
                  <Flexbox horizontal gap={8}>
                    <div style={{ color: cssVar.colorTextSecondary }}>
                      {t('messages.tokenDetails.speed.ttft.title')}
                    </div>
                    <InfoTooltip title={t('messages.tokenDetails.speed.ttft.tooltip')} />
                  </Flexbox>
                  <div style={{ fontWeight: 500 }}>{ttft}s</div>
                </Flexbox>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
      }
    >
      <Center
        horizontal
        gap={2}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          // 阻止 Popover 并切换格式
          e.preventDefault();
          e.stopPropagation();
          updateSystemStatus({ tokenDisplayFormatShort: !isShortFormat });
        }}
      >
        <Icon icon={isShowCredit ? BadgeCent : CoinsIcon} />
        <AnimatedNumber
          duration={1500}
          formatter={(value) => {
            const roundedValue = Math.round(value);
            if (isShortFormat) {
              return (formatShortenNumber(roundedValue) as string).toLowerCase?.();
            }
            return new Intl.NumberFormat('en-US').format(roundedValue);
          }}
          // Force remount when switching between token/credit to prevent unwanted animation
          // See: https://github.com/lobehub/lobe-chat/pull/10098
          key={isShowCredit ? 'credit' : 'token'}
          value={totalCount}
        />
      </Center>
    </Popover>
  );
});

export default TokenDetail;
