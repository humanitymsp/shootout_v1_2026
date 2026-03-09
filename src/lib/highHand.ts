/**
 * High Hand Feature — localStorage-based state management
 * 
 * Stores high hand data in localStorage for cross-tab sync (admin → TV).
 * Each high hand round lasts 1 hour. When the hour expires, the current
 * holder is declared the winner and a new round can be started.
 */

// Card representation: rank + suit, e.g. "As" = Ace of spades, "Th" = Ten of hearts
// Ranks: 2,3,4,5,6,7,8,9,T,J,Q,K,A
// Suits: s(spades), h(hearts), d(diamonds), c(clubs)
export type CardCode = string; // e.g. "As", "Kh", "Td"

export interface HighHand {
  playerName: string;
  playerId?: string;
  handDescription: string;      // e.g. "Aces Full of Kings", "Quad Jacks"
  cards?: CardCode[];           // up to 5 cards, e.g. ["As","Ks","Qs","Js","Ts"]
  tableNumber?: number;
  roundStartTime: string;       // ISO timestamp — when this hour started
  roundDurationMs: number;      // default 3600000 (1 hour)
  assignedAt: string;           // ISO timestamp — when this hand was set
  previousWinners: HighHandWinner[];
}

export interface HighHandWinner {
  playerName: string;
  handDescription: string;
  cards?: CardCode[];
  tableNumber?: number;
  wonAt: string;                // ISO timestamp
}

const HIGH_HAND_KEY = 'high-hand-current';
const HIGH_HAND_ENABLED_KEY = 'high-hand-enabled';
const HIGH_HAND_WINNERS_KEY = 'high-hand-winners';

export function getHighHand(): HighHand | null {
  try {
    const stored = localStorage.getItem(HIGH_HAND_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function setHighHand(hand: HighHand): void {
  localStorage.setItem(HIGH_HAND_KEY, JSON.stringify(hand));
  // Trigger storage event for other tabs (TV)
  localStorage.setItem('high-hand-updated', new Date().toISOString());
}

export function clearHighHand(): void {
  localStorage.removeItem(HIGH_HAND_KEY);
  localStorage.setItem('high-hand-updated', new Date().toISOString());
}

export function isHighHandEnabled(): boolean {
  return localStorage.getItem(HIGH_HAND_ENABLED_KEY) === 'true';
}

export function setHighHandEnabled(enabled: boolean): void {
  localStorage.setItem(HIGH_HAND_ENABLED_KEY, enabled ? 'true' : 'false');
  if (!enabled) {
    clearHighHand();
  }
  localStorage.setItem('high-hand-updated', new Date().toISOString());
}

export function getHighHandWinners(): HighHandWinner[] {
  try {
    const stored = localStorage.getItem(HIGH_HAND_WINNERS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function addHighHandWinner(winner: HighHandWinner): void {
  const winners = getHighHandWinners();
  winners.unshift(winner); // newest first
  // Keep last 20 winners
  localStorage.setItem(HIGH_HAND_WINNERS_KEY, JSON.stringify(winners.slice(0, 20)));
}

/**
 * Start a new high hand round with a 1-hour countdown.
 */
export function startNewRound(
  playerName: string,
  handDescription: string,
  options?: { playerId?: string; tableNumber?: number; durationMs?: number; cards?: CardCode[] }
): HighHand {
  const now = new Date().toISOString();
  const hand: HighHand = {
    playerName,
    handDescription,
    cards: options?.cards,
    playerId: options?.playerId,
    tableNumber: options?.tableNumber,
    roundStartTime: now,
    roundDurationMs: options?.durationMs ?? 3600000, // 1 hour default
    assignedAt: now,
    previousWinners: getHighHandWinners(),
  };
  setHighHand(hand);
  return hand;
}

/**
 * Update the current high hand to a better hand (same round, clock keeps running).
 */
export function updateCurrentHand(
  playerName: string,
  handDescription: string,
  options?: { playerId?: string; tableNumber?: number; cards?: CardCode[] }
): HighHand | null {
  const current = getHighHand();
  if (!current) return null;

  const updated: HighHand = {
    ...current,
    playerName,
    handDescription,
    cards: options?.cards,
    playerId: options?.playerId,
    tableNumber: options?.tableNumber,
    assignedAt: new Date().toISOString(),
    // Keep the original roundStartTime — clock doesn't reset
  };
  setHighHand(updated);
  return updated;
}

/**
 * Declare the current hand holder as winner, record it, and clear the round.
 */
export function declareWinner(): HighHandWinner | null {
  const current = getHighHand();
  if (!current) return null;

  const winner: HighHandWinner = {
    playerName: current.playerName,
    handDescription: current.handDescription,
    cards: current.cards,
    tableNumber: current.tableNumber,
    wonAt: new Date().toISOString(),
  };
  addHighHandWinner(winner);
  clearHighHand();
  return winner;
}

/**
 * Get remaining time in the current round (ms). Returns 0 if expired.
 */
export function getRemainingTimeMs(): number {
  const hand = getHighHand();
  if (!hand) return 0;
  const elapsed = Date.now() - new Date(hand.roundStartTime).getTime();
  return Math.max(0, hand.roundDurationMs - elapsed);
}

/**
 * Check if the current round has expired.
 */
export function isRoundExpired(): boolean {
  const hand = getHighHand();
  if (!hand) return true;
  return getRemainingTimeMs() <= 0;
}
