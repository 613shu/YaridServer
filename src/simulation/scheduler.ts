/**
 * Background scheduler: runs due ticks while the server is awake.
 *
 * - Requests never wait for it (it runs on its own timer).
 * - After the server slept, at most MAX_CATCHUP_HOURS ticks are replayed;
 *   older missed time is skipped, as if the fair was closed.
 */
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { RULES } from "../game/rules";
import { getGameState } from "./clock";
import { runTick } from "./engine";

let timer: NodeJS.Timeout | null = null;
let running = false;

/** If more than MAX_CATCHUP_HOURS are due, move lastTickAt forward so only that many remain. */
export async function skipOldMissedTime(now = new Date()): Promise<number> {
  const state = await getGameState(prisma);
  const due = Math.floor((now.getTime() - state.lastTickAt.getTime()) / env.GAME_HOUR_MS);
  if (due <= RULES.MAX_CATCHUP_HOURS) return 0;
  const skipped = due - RULES.MAX_CATCHUP_HOURS;
  const newLast = new Date(state.lastTickAt.getTime() + skipped * env.GAME_HOUR_MS);
  // Conditional update: does nothing if another instance already moved the clock
  await prisma.gameState.updateMany({ where: { id: 1, lastTickAt: state.lastTickAt }, data: { lastTickAt: newLast } });
  console.log(`⏩ Fair was closed for ${skipped} game hours — skipped.`);
  return skipped;
}

/** Runs all due ticks (max MAX_CATCHUP_HOURS). Never throws. */
export async function runDueTicks(): Promise<number> {
  if (running) return 0;
  running = true;
  let ran = 0;
  try {
    await skipOldMissedTime();
    for (let i = 0; i < RULES.MAX_CATCHUP_HOURS; i++) {
      const result = await runTick();
      if (!result) break;
      ran++;
      if (env.NODE_ENV !== "test") {
        console.log(
          `🕐 Day ${result.day} ${String(result.hour).padStart(2, "0")}:00 — ${result.visitors} visitors, ${result.sales} sales, ${result.revenue}₽ (${result.durationMs}ms)`,
        );
      }
    }
  } catch (err) {
    console.error("Simulation tick failed:", err);
  } finally {
    running = false;
  }
  return ran;
}

export function startScheduler(): void {
  if (timer || !env.SIMULATION_ENABLED) return;
  void runDueTicks();
  timer = setInterval(() => void runDueTicks(), env.SIMULATION_CHECK_MS);
  timer.unref();
  console.log(`🎪 Simulation started: 1 game hour = ${env.GAME_HOUR_MS / 1000}s`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
