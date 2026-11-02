import {
  SCORE_CAPTURE,
  SCORE_TIME_PER_SEC,
  SCORE_UPGRADE,
  STAR2_RATIO,
} from './config.ts';
import { LEVELS } from './level.ts';
import type { World } from './types.ts';

export interface ScoreParts {
  capture: number;
  upgrade: number;
  peak: number;
  time: number;
  total: number;
}

/**
 * 计分（M2.1 定稿）：
 *   分数 = 占领 × 10 + 升级花费 × 0.5 + 峰值驻军 + max(0, (par − 用时) × 2)
 *
 * 四项都能在结算面板用一行字解释：
 *   - 占领：扩张奖励
 *   - 升级花费：投资奖励（避免"憋着不升级"）
 *   - 峰值驻军：运营奖励（不鼓励无脑堆兵，因为容量有限）
 *   - 时间：快于 par 才有奖励，慢于 par 不扣分
 */
export function scoreBreakdown(w: World): ScoreParts {
  const level = LEVELS[w.levelId] ?? LEVELS[0];
  const capture = Math.round(w.stats.captured * SCORE_CAPTURE);
  const upgrade = Math.round(w.stats.upgradeSpent * SCORE_UPGRADE);
  const peak = Math.floor(w.stats.peak);
  const time = Math.round(Math.max(0, level.par - w.time) * SCORE_TIME_PER_SEC);
  return { capture, upgrade, peak, time, total: capture + upgrade + peak + time };
}

export function runScore(w: World): number {
  return scoreBreakdown(w).total;
}

/** 星级：胜局才有星；3★ ≥ 三星线，2★ ≥ 0.7×三星线，否则 1★。 */
export function runStars(w: World): number {
  if (w.phase !== 'won') return 0;
  const level = LEVELS[w.levelId] ?? LEVELS[0];
  const score = runScore(w);
  if (score >= level.star3) return 3;
  if (score >= level.star3 * STAR2_RATIO) return 2;
  return 1;
}

/** 三星线本身（供 UI / 文档 / 测试引用）。 */
export function starLines(levelId: number): { par: number; star3: number; star2: number } {
  const level = LEVELS[levelId] ?? LEVELS[0];
  return {
    par: level.par,
    star3: level.star3,
    star2: Math.round(level.star3 * STAR2_RATIO),
  };
}
