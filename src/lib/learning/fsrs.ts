// Thin adapter over ts-fsrs (validated, maintained FSRS implementation).
// No scheduling math lives here: we only convert between our persisted card
// rows and ts-fsrs Card objects.
import { fsrs, generatorParameters, type Card, type FSRS, type Grade, Rating, State } from "ts-fsrs";
import type { CardRow, FsrsState } from "./types";

export { Rating, State };
export type { Grade };

export function makeScheduler(requestRetention = 0.9): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: Math.min(0.97, Math.max(0.7, requestRetention)),
      maximum_interval: 36500,
      enable_fuzz: true,
      enable_short_term: true,
    }),
  );
}

export function toCard(c: CardRow): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review != null ? new Date(c.last_review) : undefined,
  };
}

export function fromCard(c: Card): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

/** Scheduler output for one answer. */
export function schedule(s: FSRS, row: CardRow, rating: Grade, now: Date): FsrsState {
  return fromCard(s.next(toCard(row), now, rating).card);
}

/** Due time for each possible rating, for labelling the answer buttons. */
export function previewDue(s: FSRS, row: CardRow, now: Date): Record<1 | 2 | 3 | 4, number> {
  const p = s.repeat(toCard(row), now);
  return {
    1: p[Rating.Again].card.due.getTime(),
    2: p[Rating.Hard].card.due.getTime(),
    3: p[Rating.Good].card.due.getTime(),
    4: p[Rating.Easy].card.due.getTime(),
  };
}

/** Probability of recall right now (0..1). New cards return 0. */
export function retrievability(s: FSRS, row: CardRow, now: Date): number {
  if (row.state === State.New) return 0;
  return s.get_retrievability(toCard(row), now, false);
}

export function formatInterval(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  const mo = d / 30;
  if (mo < 12) return `${mo.toFixed(mo < 3 ? 1 : 0)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
