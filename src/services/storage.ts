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
  achievements: Record<string, string>;
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
  achievements: {},
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

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  hidden?: boolean;
}

export const achievements: AchievementDefinition[] = [
  { id: "first_hit", title: "First Blood", description: "Land your first hit." },
  { id: "first_sink", title: "Shipbreaker", description: "Sink your first ship." },
  { id: "first_win", title: "Captain's Mark", description: "Win your first match." },
  { id: "blitz_win", title: "Clock Captain", description: "Win with Blitz Mode enabled." },
  { id: "flawless_fleet", title: "Untouched Fleet", description: "Win before losing any ships.", hidden: true },
  { id: "fog_hit", title: "Through the Fog", description: "Hit a ship during Fog Tide.", hidden: true },
  { id: "storm_chaser", title: "Storm Chaser", description: "Have a ship moved by Storm Mode.", hidden: true },
  { id: "treasure_found", title: "Buried Booty", description: "Find real treasure.", hidden: true },
  { id: "fake_treasure", title: "Fool's Gold", description: "Find fake treasure.", hidden: true },
  { id: "cursed_curve", title: "Crooked Cannon", description: "Have a cursed cannonball curve.", hidden: true },
  { id: "shield_save", title: "Lucky Charm", description: "Block a hit with a treasure shield.", hidden: true },
  { id: "curveball", title: "Curveball!", description: "Have a cursed shot curve to another tile.", hidden: true },
  { id: "big_board_win", title: "Big Sea Captain", description: "Win on a 16x16 or larger board." },
  { id: "perfect_accuracy", title: "No Splash Zone", description: "Win a match without missing.", hidden: true },
  { id: "ten_wins", title: "Fleet Veteran", description: "Win 10 matches." },
  { id: "admin_nuke", title: "Unfair Seas", description: "Use the admin nuke.", hidden: true },
  { id: "long_battle", title: "Sea Marathon", description: "Finish a match with at least 40 moves." },
  { id: "prestige_1", title: "Prestige Captain", description: "Prestige for the first time.", hidden: true }
];

export function makeEmptyStats(): PlayerStats {
  return {
    ...defaultStats,
    achievements: {},
    opponents: {},
    history: []
  };
}

export function xpForRank(rank: number): number {
  if (rank <= 1) {
    return 0;
  }
  const capped = Math.min(rank, maxRank);
  const completedRanks = capped - 1;
  return Math.round(completedRanks ** 2 * 170 + completedRanks * 80);
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
  return unlockAchievement({
    ...stats,
    xp: 0,
    prestige: stats.prestige + 1
  }, "prestige_1").stats;
}

export function getAchievement(id: string): AchievementDefinition | undefined {
  return achievements.find((achievement) => achievement.id === id);
}

export function unlockAchievement(stats: PlayerStats, achievementId: string): { stats: PlayerStats; unlocked?: AchievementDefinition } {
  const achievement = getAchievement(achievementId);
  if (!achievement || stats.achievements[achievementId]) {
    return { stats };
  }
  return {
    stats: {
      ...stats,
      achievements: {
        ...stats.achievements,
        [achievementId]: new Date().toISOString()
      }
    },
    unlocked: achievement
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
    achievements: loaded.achievements ?? {},
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
