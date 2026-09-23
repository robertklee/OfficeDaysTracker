import { recommendWeeks, type WeeklyRecommendations } from '../domain/planning';
import { type Snapshot } from '../domain/projection';

export type PlanningResponse =
  | {
      result: WeeklyRecommendations;
      error?: never;
    }
  | { error: string; result?: never };

self.onmessage = (event: MessageEvent<Snapshot>) => {
  let response: PlanningResponse;
  try {
    response = { result: recommendWeeks(event.data) };
  } catch {
    response = {
      error: 'Could not calculate weekly targets. Try again.',
    };
  }
  self.postMessage(response);
};
