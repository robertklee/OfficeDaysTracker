import { z } from 'zod';
import { api } from './api';
import { editActionSchema, snapshotSchema, type Action, type PlannerRepository } from './model';

export class RemoteRepository implements PlannerRepository {
  private mutations = new WeakMap<Action, string>();
  constructor(private readonly accountId: string) {}

  async read() {
    return (
      await api('/planner', z.object({ snapshot: snapshotSchema }).strict(), {
        accountId: this.accountId,
      })
    ).snapshot;
  }

  async perform(action: Action) {
    let id = this.mutations.get(action);
    if (!id) {
      id = crypto.randomUUID();
      this.mutations.set(action, id);
    }
    const result = await api(
      '/planner',
      z
        .object({
          snapshot: snapshotSchema,
          inverse: editActionSchema.nullable(),
        })
        .strict(),
      { accountId: this.accountId, body: { id, action } },
    );
    return result.inverse;
  }
}
