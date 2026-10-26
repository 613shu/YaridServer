import { env } from "../config/env";
import type { Db, Tx } from "../db/prisma";
import { RULES } from "../game/rules";

export interface GameClock {
  day: number;
  hour: number;
  lastTickAt: string;
  nextTickAt: string;
  msPerGameHour: number;
  msPerGameDay: number;
}

/** Returns the singleton GameState row, creating it on first use. */
export async function getGameState(db: Db | Tx) {
  return db.gameState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, currentDay: 1, currentHour: 0, lastTickAt: new Date() },
  });
}

export function toClock(state: { currentDay: number; currentHour: number; lastTickAt: Date }): GameClock {
  return {
    day: state.currentDay,
    hour: state.currentHour,
    lastTickAt: state.lastTickAt.toISOString(),
    nextTickAt: new Date(state.lastTickAt.getTime() + env.GAME_HOUR_MS).toISOString(),
    msPerGameHour: env.GAME_HOUR_MS,
    msPerGameDay: env.GAME_HOUR_MS * RULES.HOURS_PER_DAY,
  };
}

export async function getClock(db: Db | Tx): Promise<GameClock> {
  return toClock(await getGameState(db));
}

export function nextHour(day: number, hour: number): { day: number; hour: number; isNewDay: boolean } {
  if (hour + 1 >= RULES.HOURS_PER_DAY) return { day: day + 1, hour: 0, isNewDay: true };
  return { day, hour: hour + 1, isNewDay: false };
}
