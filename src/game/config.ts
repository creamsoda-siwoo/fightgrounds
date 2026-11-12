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
  /** upper bound on the device pixel ratio actually rendered */
  maxPixelRatio: number;
  shadows: boolean;
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
  /** distance at which vegetation chunks switch to their low detail mesh */
  treeLod: number;
  /** small props (bushes) are not drawn beyond this */
  clutterRange: number;
  lootRange: number;
  /** trees and rocks are not drawn beyond this horizontal distance */
  treeRange: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    label: '낮음', maxPixelRatio: 1, shadows: false, shadowMap: 512, shadowRange: 40, msaa: 0, grass: 0, grassRange: 30,
    bloom: false, treeShadows: false, viewDistance: 1100, aniso: 1, textureSize: 256, treeLod: 0, clutterRange: 180, lootRange: 45, treeRange: 380,
  },
  medium: {
    label: '보통', maxPixelRatio: 1.25, shadows: true, shadowMap: 1024, shadowRange: 55, msaa: 2, grass: 14000, grassRange: 28,
    bloom: false, treeShadows: false, viewDistance: 1800, aniso: 4, textureSize: 512, treeLod: 90, clutterRange: 260, lootRange: 60, treeRange: 700,
  },
  high: {
    label: '높음', maxPixelRatio: 1.5, shadows: true, shadowMap: 2048, shadowRange: 80, msaa: 2, grass: 40000, grassRange: 40,
    bloom: true, treeShadows: true, viewDistance: 2600, aniso: 8, textureSize: 512, treeLod: 160, clutterRange: 400, lootRange: 75, treeRange: 5000,
  },
  ultra: {
    label: '울트라', maxPixelRatio: 2, shadows: true, shadowMap: 4096, shadowRange: 110, msaa: 4, grass: 100000, grassRange: 55,
    bloom: true, treeShadows: true, viewDistance: 3600, aniso: 16, textureSize: 1024, treeLod: 300, clutterRange: 900, lootRange: 85, treeRange: 5000,
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
