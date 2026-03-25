export class DurableObject<Env = unknown> {
  protected ctx: any;
  protected env: Env;

  constructor(ctx: any, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
