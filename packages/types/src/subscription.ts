export enum Plans {
  Free = 'free',
  Hobby = 'hobby',
  Max = 'max',
  Plus = 'plus',
  Premium = 'premium',
  /**
   * Shares its string value with the workspace `pro` tier. Personal and
   * workspace plans are stored, priced and resolved separately, so the two are
   * never compared against each other.
   */
  Pro = 'pro',
  Starter = 'starter',
  Ultimate = 'ultimate',
}
