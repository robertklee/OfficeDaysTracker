import { strategyLabel, suggest, type Suggestion } from '../domain/planning';
import { forecast, type Snapshot } from '../domain/projection';

export type PlanningResponse =
  | {
      result: Suggestion;
      strategies: Record<string, ReturnType<typeof strategyLabel>>;
      error?: never;
    }
  | { error: string; result?: never };

self.onmessage = (event: MessageEvent<Snapshot>) => {
  let response: PlanningResponse;
  try {
    const result = suggest(event.data);
    const strategies = Object.fromEntries(
      forecast(event.data).checkpoints.map((point) => [
        point.weekStart,
        strategyLabel(event.data, point.weekStart, result.dates),
      ]),
    );
    response = { result, strategies };
  } catch {
    response = {
      error:
        'Unable to complete the planning search. No changes were made. Try again or plan directly in Calendar.',
    };
  }
  self.postMessage(response);
};
