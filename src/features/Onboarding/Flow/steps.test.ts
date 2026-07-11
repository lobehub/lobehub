import type { OnboardingCapabilities } from '@lobechat/types';
import { OnboardingStep } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  getNextOnboardingStep,
  getPreviousOnboardingStep,
  getVisibleOnboardingSteps,
  isLastVisibleStep,
  resolveVisibleStep,
} from './steps';

const allOn: OnboardingCapabilities = {
  analysis: true,
  composio: true,
  messenger: true,
  starterTasks: true,
};

describe('getVisibleOnboardingSteps', () => {
  it('returns all 7 steps when every capability is on', () => {
    expect(getVisibleOnboardingSteps(allOn)).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ConnectApps,
      OnboardingStep.LearnYourWorld,
      OnboardingStep.Profile,
      OnboardingStep.ChiefAgent,
      OnboardingStep.Messenger,
      OnboardingStep.StarterTasks,
    ]);
  });

  it('drops ConnectApps, LearnYourWorld, Profile when composio is off', () => {
    expect(getVisibleOnboardingSteps({ ...allOn, composio: false })).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ChiefAgent,
      OnboardingStep.Messenger,
      OnboardingStep.StarterTasks,
    ]);
  });

  it('drops LearnYourWorld and Profile when analysis is off but composio is on', () => {
    expect(getVisibleOnboardingSteps({ ...allOn, analysis: false })).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ConnectApps,
      OnboardingStep.ChiefAgent,
      OnboardingStep.Messenger,
      OnboardingStep.StarterTasks,
    ]);
  });

  it('drops ConnectApps, LearnYourWorld, Profile when both composio and analysis are off', () => {
    expect(getVisibleOnboardingSteps({ ...allOn, analysis: false, composio: false })).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ChiefAgent,
      OnboardingStep.Messenger,
      OnboardingStep.StarterTasks,
    ]);
  });

  it('drops Messenger when messenger is off', () => {
    expect(getVisibleOnboardingSteps({ ...allOn, messenger: false })).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ConnectApps,
      OnboardingStep.LearnYourWorld,
      OnboardingStep.Profile,
      OnboardingStep.ChiefAgent,
      OnboardingStep.StarterTasks,
    ]);
  });

  it('drops StarterTasks when starterTasks is off', () => {
    expect(getVisibleOnboardingSteps({ ...allOn, starterTasks: false })).toEqual([
      OnboardingStep.Welcome,
      OnboardingStep.ConnectApps,
      OnboardingStep.LearnYourWorld,
      OnboardingStep.Profile,
      OnboardingStep.ChiefAgent,
      OnboardingStep.Messenger,
    ]);
  });

  it('returns the minimal [Welcome, ChiefAgent] set when all capabilities are off', () => {
    expect(
      getVisibleOnboardingSteps({
        analysis: false,
        composio: false,
        messenger: false,
        starterTasks: false,
      }),
    ).toEqual([OnboardingStep.Welcome, OnboardingStep.ChiefAgent]);
  });
});

describe('getNextOnboardingStep / getPreviousOnboardingStep', () => {
  const visible = [
    OnboardingStep.Welcome,
    OnboardingStep.ChiefAgent,
    OnboardingStep.Messenger,
    OnboardingStep.StarterTasks,
  ];

  it('returns the nearest visible step after current', () => {
    expect(getNextOnboardingStep(OnboardingStep.Welcome, visible)).toBe(OnboardingStep.ChiefAgent);
  });

  it('returns undefined when current is the last visible step', () => {
    expect(getNextOnboardingStep(OnboardingStep.StarterTasks, visible)).toBeUndefined();
  });

  it('returns the nearest visible step after a hidden current step', () => {
    expect(getNextOnboardingStep(OnboardingStep.ConnectApps, visible)).toBe(
      OnboardingStep.ChiefAgent,
    );
  });

  it('returns the nearest visible step before current', () => {
    expect(getPreviousOnboardingStep(OnboardingStep.Messenger, visible)).toBe(
      OnboardingStep.ChiefAgent,
    );
  });

  it('returns undefined when current is the first visible step', () => {
    expect(getPreviousOnboardingStep(OnboardingStep.Welcome, visible)).toBeUndefined();
  });

  it('returns the nearest visible step before a hidden current step', () => {
    expect(getPreviousOnboardingStep(OnboardingStep.Profile, visible)).toBe(OnboardingStep.Welcome);
  });
});

describe('isLastVisibleStep', () => {
  const visible = [OnboardingStep.Welcome, OnboardingStep.ChiefAgent, OnboardingStep.Messenger];

  it('returns false when a visible step exists after current', () => {
    expect(isLastVisibleStep(OnboardingStep.Welcome, visible)).toBe(false);
  });

  it('returns true when current is the last visible step', () => {
    expect(isLastVisibleStep(OnboardingStep.Messenger, visible)).toBe(true);
  });

  it('returns true when current is hidden but past the last visible step', () => {
    expect(isLastVisibleStep(OnboardingStep.StarterTasks, visible)).toBe(true);
  });
});

describe('resolveVisibleStep', () => {
  const visible = [OnboardingStep.Welcome, OnboardingStep.ChiefAgent, OnboardingStep.Messenger];

  it('returns the first visible step when persisted is undefined', () => {
    expect(resolveVisibleStep(undefined, visible)).toBe(OnboardingStep.Welcome);
  });

  it('returns the persisted step when it is visible', () => {
    expect(resolveVisibleStep(OnboardingStep.ChiefAgent, visible)).toBe(OnboardingStep.ChiefAgent);
  });

  it('returns the nearest visible step after a hidden mid-flow persisted step', () => {
    expect(resolveVisibleStep(OnboardingStep.ConnectApps, visible)).toBe(OnboardingStep.ChiefAgent);
  });

  it('returns the last visible step when persisted is hidden and past the end', () => {
    expect(resolveVisibleStep(OnboardingStep.StarterTasks, visible)).toBe(OnboardingStep.Messenger);
  });

  it('returns the first visible step when persisted is out of range', () => {
    expect(resolveVisibleStep(0, visible)).toBe(OnboardingStep.Welcome);
    expect(resolveVisibleStep(99, visible)).toBe(OnboardingStep.Welcome);
  });
});
