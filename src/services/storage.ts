import type { PeerIdentity } from "../types/game";

const profileKey = "sea-battle.profile.v1";
const statsKey = "sea-battle.stats.v1";

export interface PlayerProfile {
  playerId: string;
  displayName: string;
  avatar: string;
  createdAt: number;
}

export interface MatchRecord {
  id: string;
  date: string;
  opponent: PeerIdentity;
  boardSize: number;
  mode: string;
  result: "win" | "loss";
  moves: number;
  durationMs: number;
}

export interface PlayerStats {
  totalGames: number;
  wins: number;
  losses: number;
  totalShots: number;
  hits: number;
  shipsDestroyed: number;
  xp: number;
  lifetimeXp: number;
  prestige: number;
  fastestWinMs: number | null;
  longestGameMs: number | null;
  opponents: Record<
    string,
    {
      displayName: string;
      games: number;
      wins: number;
      losses: number;
    }
  >;
  history: MatchRecord[];
}

export interface ExportBundle {
  exportedAt: string;
  profile: PlayerProfile;
  stats: PlayerStats;
}

const defaultStats: PlayerStats = {
  totalGames: 0,
  wins: 0,
  losses: 0,
  totalShots: 0,
  hits: 0,
  shipsDestroyed: 0,
  xp: 0,
  lifetimeXp: 0,
  prestige: 0,
  fastestWinMs: null,
  longestGameMs: null,
  opponents: {},
  history: []
};

export const maxRank = 55;

export const xpAwards = {
  shot: 5,
  hit: 20,
  sunk: 60,
  win: 350,
  loss: 90
} as const;

export function makeEmptyStats(): PlayerStats {
  return {
    ...defaultStats,
    opponents: {},
    history: []
  };
}

export function xpForRank(rank: number): number {
  if (rank <= 1) {
    return 0;
  }
  const capped = Math.min(rank, maxRank);
  return Math.round((capped - 1) * 180 + (capped - 1) ** 2 * 28);
}

export function getRankProgress(xp: number): { rank: number; currentXp: number; nextXp: number; progress: number } {
  for (let rank = 1; rank < maxRank; rank += 1) {
    const nextXp = xpForRank(rank + 1);
    if (xp < nextXp) {
      const currentXp = xpForRank(rank);
      return {
        rank,
        currentXp,
        nextXp,
        progress: Math.max(0, Math.min(1, (xp - currentXp) / (nextXp - currentXp)))
      };
    }
  }

  return {
    rank: maxRank,
    currentXp: xpForRank(maxRank),
    nextXp: xpForRank(maxRank),
    progress: 1
  };
}

export function awardXp(stats: PlayerStats, amount: number): PlayerStats {
  const xp = Math.max(0, Math.round(amount));
  return {
    ...stats,
    xp: stats.xp + xp,
    lifetimeXp: stats.lifetimeXp + xp
  };
}

export function prestigeStats(stats: PlayerStats): PlayerStats {
  if (getRankProgress(stats.xp).rank < maxRank) {
    return stats;
  }
  return {
    ...stats,
    xp: 0,
    prestige: stats.prestige + 1
  };
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function randomPlayerId(): string {
  return `player_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadProfile(): PlayerProfile {
  const existing = safeParse<PlayerProfile | null>(localStorage.getItem(profileKey), null);
  if (existing) {
    return existing;
  }

  const profile: PlayerProfile = {
    playerId: randomPlayerId(),
    displayName: `Captain ${Math.floor(1000 + Math.random() * 8999)}`,
    avatar: "anchor",
    createdAt: Date.now()
  };
  saveProfile(profile);
  return profile;
}

export function saveProfile(profile: PlayerProfile): void {
  localStorage.setItem(profileKey, JSON.stringify(profile));
}

export function loadStats(): PlayerStats {
  const loaded = safeParse<Partial<PlayerStats>>(localStorage.getItem(statsKey), defaultStats);
  return {
    ...defaultStats,
    ...loaded,
    xp: loaded.xp ?? 0,
    lifetimeXp: loaded.lifetimeXp ?? loaded.xp ?? 0,
    prestige: loaded.prestige ?? 0,
    opponents: loaded.opponents ?? {},
    history: loaded.history ?? []
  };
}

export function saveStats(stats: PlayerStats): void {
  localStorage.setItem(statsKey, JSON.stringify(stats));
}

export function summarizeStats(stats: PlayerStats): PeerIdentity["statsSummary"] {
  return {
    games: stats.totalGames,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.totalGames ? Math.round((stats.wins / stats.totalGames) * 100) : 0
  };
}

export function makeIdentity(profile: PlayerProfile, stats: PlayerStats): PeerIdentity {
  return {
    playerId: profile.playerId,
    displayName: profile.displayName,
    avatar: profile.avatar,
    statsSummary: summarizeStats(stats)
  };
}

export function recordMatch(stats: PlayerStats, record: MatchRecord): PlayerStats {
  const won = record.result === "win";
  const opponent = stats.opponents[record.opponent.playerId] ?? {
    displayName: record.opponent.displayName,
    games: 0,
    wins: 0,
    losses: 0
  };

  const withMatchXp = awardXp(stats, won ? xpAwards.win : xpAwards.loss);

  return {
    ...withMatchXp,
    totalGames: withMatchXp.totalGames + 1,
    wins: withMatchXp.wins + (won ? 1 : 0),
    losses: withMatchXp.losses + (won ? 0 : 1),
    fastestWinMs: won ? Math.min(withMatchXp.fastestWinMs ?? record.durationMs, record.durationMs) : withMatchXp.fastestWinMs,
    longestGameMs: Math.max(withMatchXp.longestGameMs ?? record.durationMs, record.durationMs),
    opponents: {
      ...withMatchXp.opponents,
      [record.opponent.playerId]: {
        displayName: record.opponent.displayName,
        games: opponent.games + 1,
        wins: opponent.wins + (won ? 1 : 0),
        losses: opponent.losses + (won ? 0 : 1)
      }
    },
    history: [record, ...stats.history].slice(0, 100)
  };
}

export function removeMatch(stats: PlayerStats, matchId: string): PlayerStats {
  const record = stats.history.find((entry) => entry.id === matchId);
  if (!record) {
    return stats;
  }

  const won = record.result === "win";
  const history = stats.history.filter((entry) => entry.id !== matchId);
  const nextOpponents = { ...stats.opponents };
  const opponent = nextOpponents[record.opponent.playerId];
  if (opponent) {
    const games = Math.max(0, opponent.games - 1);
    if (games === 0) {
      delete nextOpponents[record.opponent.playerId];
    } else {
      nextOpponents[record.opponent.playerId] = {
        ...opponent,
        games,
        wins: Math.max(0, opponent.wins - (won ? 1 : 0)),
        losses: Math.max(0, opponent.losses - (won ? 0 : 1))
      };
    }
  }

  const winDurations = history.filter((entry) => entry.result === "win").map((entry) => entry.durationMs);
  const allDurations = history.map((entry) => entry.durationMs);

  return {
    ...stats,
    totalGames: Math.max(0, stats.totalGames - 1),
    wins: Math.max(0, stats.wins - (won ? 1 : 0)),
    losses: Math.max(0, stats.losses - (won ? 0 : 1)),
    fastestWinMs: winDurations.length ? Math.min(...winDurations) : null,
    longestGameMs: allDurations.length ? Math.max(...allDurations) : null,
    opponents: nextOpponents,
    history
  };
}

export function exportProfile(profile: PlayerProfile, stats: PlayerStats): string {
  const bundle: ExportBundle = {
    exportedAt: new Date().toISOString(),
    profile,
    stats
  };
  return JSON.stringify(bundle, null, 2);
}

export function importProfile(raw: string): ExportBundle {
  const bundle = JSON.parse(raw) as ExportBundle;
  if (!bundle.profile?.playerId || !bundle.stats) {
    throw new Error("Invalid profile export");
  }
  saveProfile(bundle.profile);
  saveStats(bundle.stats);
  return bundle;
}
