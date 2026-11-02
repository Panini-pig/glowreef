import type { Faction, SpellId } from '../sim/types.ts';

export interface FactionPaint {
  core: string;
  mid: string;
  deep: string;
  glow: string;
  dim: string;
}

export const PAINT: Record<Faction, FactionPaint> = {
  0: {
    core: '#DCEAF2',
    mid: '#8FA9B8',
    deep: '#3B505E',
    glow: 'rgba(190, 224, 238, 0.55)',
    dim: 'rgba(160, 186, 200, 0.35)',
  },
  1: {
    core: '#B8FEFF',
    mid: '#2FD9E8',
    deep: '#0B6E86',
    glow: 'rgba(90, 245, 255, 0.75)',
    dim: 'rgba(47, 217, 232, 0.32)',
  },
  2: {
    core: '#FFD3E1',
    mid: '#FF4E8E',
    deep: '#8E1B48',
    glow: 'rgba(255, 120, 168, 0.72)',
    dim: 'rgba(255, 78, 142, 0.3)',
  },
};

export const GOLD = '#FFD66B';
export const GOLD_DIM = 'rgba(255, 214, 107, 0.45)';
export const INK = '#02121A';

/** 法术色：与阵营色区分，保证「谁的魔法」一眼可读。 */
export const SPELL_COLOR: Record<SpellId, { core: string; mid: string; deep: string; glow: string }> = {
  freeze: {
    core: '#EAFBFF',
    mid: '#8FE3FF',
    deep: '#1B6E93',
    glow: 'rgba(150, 230, 255, 0.78)',
  },
  infect: {
    core: '#EAFFD9',
    mid: '#8CFF7A',
    deep: '#2C6B22',
    glow: 'rgba(140, 255, 122, 0.74)',
  },
  capture: {
    core: '#F4E6FF',
    mid: '#C79BFF',
    deep: '#5B2C8C',
    glow: 'rgba(199, 155, 255, 0.8)',
  },
};

export const ABYSS_TOP = '#020610';
export const ABYSS_BOTTOM = '#061a26';
export const HAZE = 'rgba(24, 148, 168, 0.16)';
