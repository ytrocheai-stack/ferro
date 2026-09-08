export class WorkflowEntrypoint<Env = unknown> {
  protected env: Env
  constructor(_ctx?: unknown, env?: Env) { this.env = env as Env }
}
