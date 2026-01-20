
export interface GCP_BLH {
  id: number;
  lat: number;
  lon: number;
  alt: number;
}

export interface PixelCoord {
  id: number;
  u: number;
  v: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectedGCP {
  id: number;
  x: number;
  y: number;
  originalZ: number; // The Z value before projection (for debugging/visualization of depth)
}

export interface RotationState {
  x: number; // Degrees
  y: number; // Degrees
  z: number; // Degrees
}

export enum EvaluationMode {
  ALIGNMENT = 'ALIGNMENT', // 2-Point Rigid
  GLOBAL_ADJUSTMENT = 'GLOBAL_ADJUSTMENT', // Least Squares
  DISTANCE_RATIO = 'DISTANCE_RATIO', // Relative Distances
}

export interface AlignmentResult {
  scale: number;
  rotation: number; // radians
  translation: { x: number; y: number };
  rmse: number;
  errors: { id: number; error: number; transformed: {x: number, y: number} }[];
}

export interface RatioResult {
  baseScale: number; // meter per pixel
  errors: { 
    pair: [number, number]; 
    pixelDistance: number; 
    projectedDistance: number; 
    calculatedDistance: number; 
    diff: number; 
    percentError: number;
  }[];
  meanPercentError: number;
}