export const DEBATE_ROUTE_MAX_DURATION_SECONDS = 1740;
export const DEBATE_ROUTE_MAX_DURATION_MS =
  DEBATE_ROUTE_MAX_DURATION_SECONDS * 1000;

// Keep enough wall-clock time after the final provider call for persistence,
// durable run-state updates, and the user-visible completion event.
export const DEBATE_FINALIZATION_RESERVE_MS = 120_000;
export const DEBATE_SEAT_HANDOFF_BUFFER_MS = 10_000;
export const DEBATE_MIN_SEAT_START_BUDGET_MS = 30_000;

// A hard platform timeout cannot run cleanup code. Treat a still-active run as
// stale shortly after the configured route ceiling has elapsed.
export const DEBATE_STALE_ACTIVE_RUN_AFTER_MS =
  DEBATE_ROUTE_MAX_DURATION_MS + 60_000;

export interface DebateSeatBudgetInput {
  elapsedTurnMs: number;
  seatsRemaining: number;
  configuredSeatCount: number;
}

export function calculateDebateSeatTimeoutMs({
  elapsedTurnMs,
  seatsRemaining,
  configuredSeatCount,
}: DebateSeatBudgetInput): number {
  if (seatsRemaining <= 0) return 0;

  const usableTurnBudgetRemainingMs = Math.max(
    0,
    DEBATE_ROUTE_MAX_DURATION_MS -
      DEBATE_FINALIZATION_RESERVE_MS -
      Math.max(0, elapsedTurnMs)
  );

  if (usableTurnBudgetRemainingMs <= DEBATE_MIN_SEAT_START_BUDGET_MS) {
    return 0;
  }

  const fairShareMs =
    Math.floor(usableTurnBudgetRemainingMs / seatsRemaining) -
    DEBATE_SEAT_HANDOFF_BUFFER_MS;

  if (fairShareMs < DEBATE_MIN_SEAT_START_BUDGET_MS) {
    return 0;
  }

  // These are provider safety ceilings, not target durations. Fast seats still
  // finish immediately. Later seats can inherit unused wall-clock headroom.
  const seatTimeoutCapMs =
    configuredSeatCount <= 1
      ? 1_500_000 // 25 minutes
      : configuredSeatCount === 2
        ? 780_000 // 13 minutes
        : 600_000; // 10 minutes

  return Math.max(
    DEBATE_MIN_SEAT_START_BUDGET_MS,
    Math.min(seatTimeoutCapMs, fairShareMs)
  );
}
