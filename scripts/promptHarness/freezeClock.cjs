const RealDate = Date;
const frozenTime = process.env.PROMPT_HARNESS_FROZEN_TIME;

if (!frozenTime || Number.isNaN(RealDate.parse(frozenTime))) {
  throw new Error('PROMPT_HARNESS_FROZEN_TIME must be a valid ISO timestamp.');
}

class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(frozenTime);
      return;
    }
    super(...args);
  }

  static now() {
    return RealDate.now();
  }

  static parse(value) {
    return RealDate.parse(value);
  }

  static UTC(...args) {
    return RealDate.UTC(...args);
  }
}

globalThis.Date = FrozenDate;
