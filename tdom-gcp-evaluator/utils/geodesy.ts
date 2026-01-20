import { GCP_BLH, Point3D, Point2D, RotationState } from '../types';

// WGS84 Constants
const A = 6378137.0; // Semi-major axis
const F = 1 / 298.257223563; // Flattening
const E2 = 2 * F - F * F; // Square of eccentricity

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Converts Geodetic (Lat, Lon, Alt) to ECEF (Earth-Centered, Earth-Fixed)
 */
export const blhToEcef = (lat: number, lon: number, alt: number): Point3D => {
  const latRad = degToRad(lat);
  const lonRad = degToRad(lon);
  const N = A / Math.sqrt(1 - E2 * Math.sin(latRad) * Math.sin(latRad));

  const x = (N + alt) * Math.cos(latRad) * Math.cos(lonRad);
  const y = (N + alt) * Math.cos(latRad) * Math.sin(lonRad);
  const z = (N * (1 - E2) + alt) * Math.sin(latRad);

  return { x, y, z };
};

/**
 * Calculates the centroid of a set of 3D points
 */
export const getCentroid = (points: Point3D[]): Point3D => {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), { x: 0, y: 0, z: 0 });
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
    z: sum.z / points.length,
  };
};

/**
 * Converts ECEF to Local Tangent Plane (ENU - East, North, Up)
 * The origin is set to the provided reference point (usually centroid of points).
 */
export const ecefToEnu = (point: Point3D, refLat: number, refLon: number, refEcef: Point3D): Point3D => {
  const latRad = degToRad(refLat);
  const lonRad = degToRad(refLon);

  const dx = point.x - refEcef.x;
  const dy = point.y - refEcef.y;
  const dz = point.z - refEcef.z;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  // Transformation matrix for ECEF -> ENU
  const x = -sinLon * dx + cosLon * dy;
  const y = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const z = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  return { x, y, z };
};

/**
 * Rotates a 3D point using Euler angles (Degrees)
 * Rotation order: X (Pitch) -> Y (Roll) -> Z (Yaw)
 */
export const rotatePoint = (p: Point3D, rotation: RotationState): Point3D => {
  const rx = degToRad(rotation.x);
  const ry = degToRad(rotation.y);
  const rz = degToRad(rotation.z);

  // Rotation around X
  let y1 = p.y * Math.cos(rx) - p.z * Math.sin(rx);
  let z1 = p.y * Math.sin(rx) + p.z * Math.cos(rx);
  let x1 = p.x;

  // Rotation around Y
  let x2 = x1 * Math.cos(ry) + z1 * Math.sin(ry);
  let z2 = -x1 * Math.sin(ry) + z1 * Math.cos(ry);
  let y2 = y1;

  // Rotation around Z
  let x3 = x2 * Math.cos(rz) - y2 * Math.sin(rz);
  let y3 = x2 * Math.sin(rz) + y2 * Math.cos(rz);
  let z3 = z2;

  return { x: x3, y: y3, z: z3 };
};

export const dist2D = (p1: Point2D, p2: Point2D) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

/**
 * Parse Degrees Minutes Seconds string to decimal degrees
 * Format: "DDD MM SS.SS" or simple float
 */
export const parseDMS = (input: string): number => {
    // Simple float check
    if (!isNaN(parseFloat(input)) && isFinite(Number(input)) && !input.includes(' ')) {
        return parseFloat(input);
    }
    // Very basic DMS parser: "34 10 20.5" -> 34 + 10/60 + 20.5/3600
    const parts = input.trim().split(/\s+/).map(Number);
    if (parts.length === 3) {
        const sign = parts[0] < 0 ? -1 : 1;
        return parts[0] + (sign * parts[1]) / 60 + (sign * parts[2]) / 3600;
    }
    return parseFloat(input) || 0;
};
