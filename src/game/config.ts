export const WORLD_SIZE = 1280;
export const WORLD_HALF = WORLD_SIZE / 2;
export const TERRAIN_SEG = 320;
export const ISLAND_RADIUS = 540;
export const TOTAL_PLAYERS = 40;

export const PLAYER_RADIUS = 0.36;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.25;
export const STEP_HEIGHT = 0.48;
export const GRAVITY = 13;
export const JUMP_SPEED = 4.9;
export const SWIM_DEPTH = 1.25;

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  label: string;
  pixelRatio: number;
  shadowMap: number;
  shadowRange: number;
  msaa: number;
  grass: number;
  grassRange: number;
  bloom: boolean;
  treeShadows: boolean;
  viewDistance: number;
  aniso: number;
  textureSize: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    label: '낮음', pixelRatio: 0.75, shadowMap: 1024, shadowRange: 50, msaa: 0, grass: 0, grassRange: 40,
    bloom: false, treeShadows: false, viewDistance: 1400, aniso: 2, textureSize: 256,
  },
  medium: {
    label: '보통', pixelRatio: 1, shadowMap: 2048, shadowRange: 70, msaa: 2, grass: 30000, grassRange: 36,
    bloom: true, treeShadows: true, viewDistance: 2200, aniso: 4, textureSize: 512,
  },
  high: {
    label: '높음', pixelRatio: 1.25, shadowMap: 4096, shadowRange: 90, msaa: 4, grass: 70000, grassRange: 46,
    bloom: true, treeShadows: true, viewDistance: 3000, aniso: 8, textureSize: 512,
  },
  ultra: {
    label: '울트라', pixelRatio: 2, shadowMap: 4096, shadowRange: 110, msaa: 4, grass: 130000, grassRange: 58,
    bloom: true, treeShadows: true, viewDistance: 3600, aniso: 16, textureSize: 1024,
  },
};

/** Safe zone schedule. Radii are metres, times seconds, dps = damage per second outside. */
export const ZONE_PHASES = [
  { radius: 400, wait: 80, shrink: 50, dps: 0.8 },
  { radius: 245, wait: 55, shrink: 40, dps: 1.6 },
  { radius: 140, wait: 45, shrink: 32, dps: 3 },
  { radius: 75, wait: 35, shrink: 26, dps: 5.5 },
  { radius: 34, wait: 28, shrink: 22, dps: 9 },
  { radius: 0.5, wait: 20, shrink: 22, dps: 14 },
];
