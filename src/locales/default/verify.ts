export default {
  artifact: {
    failed: {
      sub: 'This result is held back. The delivery checker found verification insufficient and triggered a repair.',
      title: 'Draft result',
    },
    foot: 'A snapshot of this run’s output — not an assistant or user message.',
    kicker: 'Run Artifact · Round {{round}}',
    passed: {
      sub: 'The delivery checker passed {{passed}}/{{total}}. This result is ready to deliver.',
      title: 'Result',
    },
    pending: {
      sub: 'The result is generated but not yet delivered — waiting for the delivery checker.',
      title: 'Draft result',
    },
    repairing: {
      sub: 'Checks did not pass. A repair round has started.',
      title: 'Draft result',
    },
  },
  badge: {
    failed: 'Check failed',
    passed: 'Check passed',
    pending: 'Awaiting check',
    repairing: 'Repair triggered',
  },
  behavior: {
    auto_improve: 'Auto-fill',
    auto_improveDesc: 'Filled in automatically; does not block delivery',
    gate: 'Delivery gate',
    gateDesc: 'Blocks delivery on failure and triggers a repair round',
  },
  dock: {
    confirm: 'Confirm & run',
    edit: 'Adjust checks',
    forceDeliver: 'Ignore & deliver',
    repairHint:
      'The next round is fixing the failed checks. A new Run Artifact is created and the checker re-runs when it finishes.',
    saveAndRepair: 'Save input & repair now',
    skip: 'Skip checks',
    title: 'Delivery Checker',
  },
  editor: {
    add: '+ Add check',
    cancel: 'Cancel',
    placeholder: 'Check title',
    save: 'Save',
  },
  input: {
    hint: 'This goes to the next repair round as checker input — it will not appear as a chat message.',
    label: 'Extra input for the next repair round',
    placeholder: 'e.g. run type-check first; if it still fails, just add a risk note.',
  },
  status: {
    checking: 'Delivery Checker: checking {{passed}}/{{total}}',
    draft: 'Delivery Checker: awaiting confirmation · {{total}} checks',
    failed: 'Delivery Checker: failed · repair triggered',
    idle: 'Delivery Checker: not generated',
    passed: 'Delivery Checker: passed {{passed}}/{{total}}',
    repairing: 'Delivery Checker: repairing',
    verifying: 'Delivery Checker: waiting for run to finish',
  },
};
