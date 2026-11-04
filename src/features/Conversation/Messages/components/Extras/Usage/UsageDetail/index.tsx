import { type ModelPerformance, type ModelUsage } from '@lobechat/types';
import { formatUsageValue, formatUsd } from '@lobechat/utils';
import { Center, cssVar, Divider, Flexbox, Icon, Popover } from '@lobehub/ui';
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
import type { TokenProgressItem } from './TokenProgress';
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

  // Use systemStatus to manage short-format display state
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
      value: isShowCredit ? detailTokens.inputAudio.cost : detailTokens.inputAudio.token,
    },
    !!detailTokens.inputCitation && {
      color: cssVar.orange,
      id: 'inputText',
      title: t('messages.tokenDetails.inputCitation'),
      value: isShowCredit ? detailTokens.inputCitation.cost : detailTokens.inputCitation.token,
    },
    !!detailTokens.inputText && {
      color: cssVar.green,
      id: 'inputText',
      title: t('messages.tokenDetails.inputText'),
      value: isShowCredit ? detailTokens.inputText.cost : detailTokens.inputText.token,
    },
  ].filter(Boolean) as TokenProgressItem[];

  const outputDetails = [
    !!detailTokens.outputReasoning && {
      color: cssVar.pink,
      id: 'reasoning',
      title: t('messages.tokenDetails.reasoning'),
      value: isShowCredit ? detailTokens.outputReasoning.cost : detailTokens.outputReasoning.token,
    },
    !!detailTokens.outputImage && {
      color: cssVar.purple,
      id: 'outputImage',
      title: t('messages.tokenDetails.outputImage'),
      value: isShowCredit ? detailTokens.outputImage.cost : detailTokens.outputImage.token,
    },
    !!detailTokens.outputAudio && {
      color: cssVar.cyan9,
      id: 'outputAudio',
      title: t('messages.tokenDetails.outputAudio'),
      value: isShowCredit ? detailTokens.outputAudio.cost : detailTokens.outputAudio.token,
    },
    !!detailTokens.outputText && {
      color: cssVar.green,
      id: 'outputText',
      title: t('messages.tokenDetails.outputText'),
      value: isShowCredit ? detailTokens.outputText.cost : detailTokens.outputText.token,
    },
  ].filter(Boolean) as TokenProgressItem[];

  const totalDetail = [
    !!detailTokens.inputCacheMiss && {
      color: cssVar.colorFill,

      id: 'uncachedInput',
      title: t('messages.tokenDetails.inputUncached'),
      value: isShowCredit ? detailTokens.inputCacheMiss.cost : detailTokens.inputCacheMiss.token,
    },
    !!detailTokens.inputCached && {
      color: cssVar.orange,
      id: 'inputCached',
      title: t('messages.tokenDetails.inputCached'),
      value: isShowCredit ? detailTokens.inputCached.cost : detailTokens.inputCached.token,
    },
    !!detailTokens.inputCachedWrite && {
      color: cssVar.yellow,
      id: 'cachedWriteInput',
      title: t('messages.tokenDetails.inputWriteCached'),
      value: isShowCredit
        ? detailTokens.inputCachedWrite.cost
        : detailTokens.inputCachedWrite.token,
    },
    !!detailTokens.inputTool && {
      color: cssVar.geekblue,
      id: 'inputTool',
      title: t('messages.tokenDetails.inputTool'),
      value: isShowCredit ? detailTokens.inputTool.cost : detailTokens.inputTool.token,
    },
    !!detailTokens.totalOutput && {
      color: cssVar.colorSuccess,
      id: 'output',
      title: t('messages.tokenDetails.output'),
      value: isShowCredit ? detailTokens.totalOutput.cost : detailTokens.totalOutput.token,
    },
  ].filter(Boolean) as TokenProgressItem[];

  const totalCount =
    isShowCredit && !!detailTokens.totalTokens
      ? detailTokens.totalTokens.cost
      : detailTokens.totalTokens!.token;

  const formatValue = isShowCredit ? formatUsd : formatUsageValue;
  const detailTotal = formatValue(totalCount);
  const cacheRate =
    typeof detailTokens.inputCacheRate === 'number'
      ? `${formatNumber(detailTokens.inputCacheRate * 100, 1)}%`
      : undefined;

  // Average unit price in USD per 1M tokens
  const averagePricing = formatUsd(
    (detailTokens.totalTokens!.cost * 1_000_000) / detailTokens.totalTokens!.token,
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
                <TokenProgress showIcon data={inputDetails} formatValue={formatValue} />
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
                <TokenProgress showIcon data={outputDetails} formatValue={formatValue} />
              </Flexbox>
            )}
            <Flexbox>
              <TokenProgress showIcon data={totalDetail} formatValue={formatValue} />
              <Divider style={{ marginBlock: 8 }} />
              {cacheRate && (
                <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
                  <div style={{ color: cssVar.colorTextSecondary }}>
                    {t('messages.tokenDetails.cacheRate')}
                  </div>
                  <div style={{ fontWeight: 500 }}>{cacheRate}</div>
                </Flexbox>
              )}
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
          // Prevent Popover from closing and toggle the format
          e.preventDefault();
          e.stopPropagation();
          updateSystemStatus({ tokenDisplayFormatShort: !isShortFormat });
        }}
      >
        <Icon icon={isShowCredit ? BadgeCent : CoinsIcon} />
        <AnimatedNumber
          duration={1500}
          // Force remount when switching between token/credit to prevent unwanted animation
          // See: https://github.com/lobehub/lobe-chat/pull/10098
          key={isShowCredit ? 'credit' : 'token'}
          value={totalCount}
          formatter={(value) => {
            if (isShowCredit) return formatUsd(value);
            const roundedValue = Math.round(value);
            if (isShortFormat) {
              return (formatShortenNumber(roundedValue) as string).toLowerCase?.();
            }
            return new Intl.NumberFormat('en-US').format(roundedValue);
          }}
        />
      </Center>
    </Popover>
  );
});

export default TokenDetail;
