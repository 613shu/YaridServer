/**
 * Who is playing right now.
 *
 * Every authenticated request marks its user as "seen". While the game is open,
 * the frontend keeps sending requests (balance, fair, customers), so a merchant
 * whose game is open stays "online". Merchants who are not online are not part
 * of the fair: their stalls sell nothing and they pay no daily stall fee.
 *
 * Kept in server memory on purpose (no DB column, no migration). After a server
 * restart the list is empty until each player's next request — a few seconds.
 */
import { RULES } from "../game/rules";

const lastSeen = new Map<number, number>();

/** Called on every authenticated request. */
export function markSeen(userId: number, now = Date.now()): void {
  lastSeen.set(userId, now);
}

/** True if the user sent a request within the last `windowMs` milliseconds. */
export function wasSeenWithin(userId: number, windowMs: number, now = Date.now()): boolean {
  const seen = lastSeen.get(userId);
  if (seen === undefined) return false;
  return now - seen <= windowMs;
}

/** Online = the game is open right now (a request in the last ONLINE_WINDOW_MS). */
export function isOnline(userId: number, now = Date.now()): boolean {
  return wasSeenWithin(userId, RULES.ONLINE_WINDOW_MS, now);
}

/** All users seen within the window. */
export function usersSeenWithin(windowMs: number, now = Date.now()): number[] {
  const ids: number[] = [];
  for (const [userId, seen] of lastSeen) {
    if (now - seen <= windowMs) ids.push(userId);
  }
  return ids;
}

/** For tests: make a user look offline. */
export function forgetPresence(userId?: number): void {
  if (userId === undefined) lastSeen.clear();
  else lastSeen.delete(userId);
}
