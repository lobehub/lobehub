'use client';

import { useAnalytics } from '@lobehub/analytics/react';
import { Button, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ONBOARDING_FEEDBACK_CONSTANTS,
  type OnboardingFeedbackRating,
  submitOnboardingComment,
  submitOnboardingRating,
} from '@/services/onboardingFeedback';

interface FeedbackPanelProps {
  hasPriorFeedback: boolean;
  topicId: string;
}

interface SubmittedRating {
  rating: OnboardingFeedbackRating;
  submittedAt: string;
}

const FeedbackPanel = memo<FeedbackPanelProps>(({ hasPriorFeedback, topicId }) => {
  const { t } = useTranslation('onboarding');
  const { analytics } = useAnalytics();

  const [done, setDone] = useState(hasPriorFeedback);
  const [submittedRating, setSubmittedRating] = useState<SubmittedRating | null>(null);
  const [pendingRating, setPendingRating] = useState<OnboardingFeedbackRating | null>(null);
  const [comment, setComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <Flexbox align={'center'} paddingBlock={8}>
        <Text type={'secondary'}>{t('agent.feedback.thanks')}</Text>
      </Flexbox>
    );
  }

  const handleRatingClick = async (next: OnboardingFeedbackRating) => {
    if (submittedRating || pendingRating) return;
    setPendingRating(next);
    setError(null);
    try {
      const result = await submitOnboardingRating(
        { rating: next, topicId },
        { analytics: analytics ?? null },
      );
      setSubmittedRating({ rating: next, submittedAt: result.submittedAt });
    } catch (submitError) {
      console.error('[FeedbackPanel] rating submit failed', submitError);
      setError(t('agent.feedback.error'));
    } finally {
      setPendingRating(null);
    }
  };

  const handleSendComment = async () => {
    if (!submittedRating || sendingComment) return;
    const trimmed = comment.trim();
    if (!trimmed) {
      setDone(true);
      return;
    }
    setSendingComment(true);
    setError(null);
    try {
      await submitOnboardingComment({
        comment: trimmed,
        rating: submittedRating.rating,
        submittedAt: submittedRating.submittedAt,
        topicId,
      });
      setDone(true);
    } catch (submitError) {
      console.error('[FeedbackPanel] comment submit failed', submitError);
      setError(t('agent.feedback.error'));
    } finally {
      setSendingComment(false);
    }
  };

  const activeRating = submittedRating?.rating ?? pendingRating;
  const ratingDisabled = !!submittedRating || !!pendingRating;

  return (
    <Flexbox align={'center'} gap={12} paddingBlock={8} width={'100%'}>
      <Text type={'secondary'}>{t('agent.feedback.prompt')}</Text>
      <Flexbox horizontal gap={8}>
        <Button
          aria-label={t('agent.feedback.rateGood')}
          disabled={ratingDisabled}
          icon={<Icon icon={ThumbsUpIcon} />}
          loading={pendingRating === 'good'}
          type={activeRating === 'good' ? 'primary' : 'default'}
          onClick={() => handleRatingClick('good')}
        />
        <Button
          aria-label={t('agent.feedback.rateBad')}
          disabled={ratingDisabled}
          icon={<Icon icon={ThumbsDownIcon} />}
          loading={pendingRating === 'bad'}
          type={activeRating === 'bad' ? 'primary' : 'default'}
          onClick={() => handleRatingClick('bad')}
        />
      </Flexbox>
      {submittedRating && (
        <Flexbox gap={8} style={{ maxWidth: 480, width: '100%' }}>
          <TextArea
            autoSize={{ maxRows: 6, minRows: 3 }}
            disabled={sendingComment}
            maxLength={ONBOARDING_FEEDBACK_CONSTANTS.COMMENT_MAX_LENGTH}
            placeholder={t('agent.feedback.placeholder')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {error && (
            <Text style={{ textAlign: 'center' }} type={'danger'}>
              {error}
            </Text>
          )}
          <Flexbox horizontal gap={8} justify={'flex-end'}>
            <Button loading={sendingComment} type={'primary'} onClick={handleSendComment}>
              {t('agent.feedback.submit')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}
      {!submittedRating && error && (
        <Text style={{ textAlign: 'center' }} type={'danger'}>
          {error}
        </Text>
      )}
    </Flexbox>
  );
});

FeedbackPanel.displayName = 'FeedbackPanel';

export default FeedbackPanel;
