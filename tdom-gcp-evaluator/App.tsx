
import React, { useState, useMemo, useCallback } from 'react';
import { RAW_GCP_DATA, RAW_PIXEL_DATA } from './constants';
import { blhToEcef, getCentroid, ecefToEnu, rotatePoint, dist2D } from './utils/geodesy';
import { RotationState, ProjectedGCP, EvaluationMode, AlignmentResult, RatioResult, PixelCoord } from './types';
import ScatterPlot from './components/ScatterPlot';
import RotationControl from './components/RotationControl';
import { Calculator, CheckCircle2, AlertCircle, Edit, Save, RotateCcw, Ban, MousePointer2, Scale, GitCompare, Globe, ScanEye, XCircle, ArrowRight, ArrowLeftRight } from 'lucide-react';
import clsx from 'clsx';

const App: React.FC = () => {
  // --- State ---
  const [rotation, setRotation] = useState<RotationState>({ x: 0, y: 0, z: 0 });
  const [pixelData, setPixelData] = useState<PixelCoord[]>(RAW_PIXEL_DATA);
  const [isEditingPixels, setIsEditingPixels] = useState(false);
  const [pixelInputText, setPixelInputText] = useState('');
  const [isTuning, setIsTuning] = useState(false);
  const [outlierResult, setOutlierResult] = useState<{worstId: number, improvement: number, originalRmse: number, newRmse: number} | null>(null);
  const [isMirrored, setIsMirrored] = useState(false); // Flip X state
  
  // Selection state
  const [selectedGCPIds, setSelectedGCPIds] = useState<number[]>([]);
  const [selectedPixelIds, setSelectedPixelIds] = useState<number[]>([]);
  
  // Exclusion State
  const [excludedPointIds, setExcludedPointIds] = useState<number[]>([]);
  const [isExcludeMode, setIsExcludeMode] = useState(false);

  const [evalMode, setEvalMode] = useState<EvaluationMode>(EvaluationMode.ALIGNMENT);

  // --- Processing ---

  // Helper: Pre-calculate Centroids for performance
  const ecefPoints = useMemo(() => RAW_GCP_DATA.map(p => blhToEcef(p.lat, p.lon, p.alt)), []);
  const centroidEcef = useMemo(() => getCentroid(ecefPoints), [ecefPoints]);
  const centroidLat = useMemo(() => RAW_GCP_DATA.reduce((sum, p) => sum + p.lat, 0) / RAW_GCP_DATA.length, []);
  const centroidLon = useMemo(() => RAW_GCP_DATA.reduce((sum, p) => sum + p.lon, 0) / RAW_GCP_DATA.length, []);
  const enuPoints = useMemo(() => ecefPoints.map(p => ecefToEnu(p, centroidLat, centroidLon, centroidEcef)), [ecefPoints, centroidEcef, centroidLat, centroidLon]);

  // 1. Convert BLH -> ECEF -> ENU (Local Tangent Plane at Centroid)
  const projectedGCPs: ProjectedGCP[] = useMemo(() => {
    return enuPoints.map((enu, index) => {
      // Apply Custom Rotation
      const rotated = rotatePoint(enu, rotation);
      return {
        id: RAW_GCP_DATA[index].id,
        x: rotated.x,
        y: rotated.y,
        originalZ: rotated.z
      };
    });
  }, [rotation, enuPoints]);

  const scatterPixelData = useMemo(() => {
    // If mirrored, we flip the X coordinate for display too, or keep it raw?
    // Usually better to keep raw in the "Pixel" view but apply mirror in math.
    // However, to visualize the flip, we can flip the X here.
    return pixelData.map(p => ({
        id: p.id, 
        x: isMirrored ? -p.u : p.u, 
        y: p.v 
    }));
  }, [pixelData, isMirrored]);

  // --- Actions ---

  const handleResetVertical = () => {
    setRotation({ x: 0, y: 0, z: 0 });
  };

  const handleResetNorth = () => {
    setRotation({ x: 90 - centroidLat, y: 0, z: 0 }); 
  };

  const pixToMath = useCallback((p: PixelCoord) => ({ 
      x: isMirrored ? -p.u : p.u, 
      y: -p.v // Image Y is down, Math Y is up
  }), [isMirrored]);

  // --- Outlier Detection (Leave-One-Out with Auto-Tune) ---
  const handleDetectOutlier = async () => {
    const activeIds = RAW_GCP_DATA.map(p => p.id).filter(id => !excludedPointIds.includes(id));
    if (activeIds.length < 4) {
        alert("Need at least 4 active points to perform robust outlier detection.");
        return;
    }

    setIsTuning(true);
    // Yield to render UI update
    await new Promise(r => setTimeout(r, 50));

    // Prepare fast lookup maps
    const pixelMap = new Map();
    pixelData.forEach(p => pixelMap.set(p.id, pixToMath(p)));

    // -- Inner Helper: Optimizer for a specific subset --
    const getOptimizedRMSE = (subsetIds: number[]) => {
        // Prepare subset indices for fast access to ENU points
        const subsetIndices = subsetIds.map(id => RAW_GCP_DATA.findIndex(p => p.id === id));
        
        // Cost function: RMSE of Least Squares Fit at specific (rx, ry)
        const computeRMSE = (rx: number, ry: number) => {
            // 1. Project GCPs
            const currentProj: {x:number, y:number}[] = [];
            const currentPix: {x:number, y:number}[] = [];

            for (let i = 0; i < subsetIndices.length; i++) {
                const idx = subsetIndices[i];
                const enu = enuPoints[idx];
                const pId = RAW_GCP_DATA[idx].id;
                
                // Rotate
                // We assume rotation.z is fixed as per current state
                const r = rotatePoint(enu, {x: rx, y: ry, z: rotation.z});
                
                const pix = pixelMap.get(pId);
                if (pix) {
                    currentProj.push({x: r.x, y: r.y});
                    currentPix.push(pix);
                }
            }
            
            if (currentProj.length < 3) return 999999;

            // 2. Least Squares Alignment (Helmert 2D)
            const n = currentProj.length;
            let sx = 0, sy = 0, tx = 0, ty = 0;
            for(let i=0; i<n; i++) { sx+=currentPix[i].x; sy+=currentPix[i].y; tx+=currentProj[i].x; ty+=currentProj[i].y; }
            const cPix = {x: sx/n, y: sy/n};
            const cGCP = {x: tx/n, y: ty/n};

            let sum_xx_yy = 0, sum_xy_yx = 0, sum_sq_src = 0;
            for(let i=0; i<n; i++) {
                const src_x = currentPix[i].x - cPix.x;
                const src_y = currentPix[i].y - cPix.y;
                const tgt_x = currentProj[i].x - cGCP.x;
                const tgt_y = currentProj[i].y - cGCP.y;
                
                sum_xx_yy += (src_x * tgt_x + src_y * tgt_y);
                sum_xy_yx += (src_x * tgt_y - src_y * tgt_x);
                sum_sq_src += (src_x * src_x + src_y * src_y);
            }

            const scale = Math.sqrt(sum_xx_yy**2 + sum_xy_yx**2) / sum_sq_src;
            const theta = Math.atan2(sum_xy_yx, sum_xx_yy);
            
            // Transform params
            const transX = cGCP.x - scale * (cPix.x * Math.cos(theta) - cPix.y * Math.sin(theta));
            const transY = cGCP.y - scale * (cPix.x * Math.sin(theta) + cPix.y * Math.cos(theta));

            // 3. Calc RMSE
            let sqErr = 0;
            for(let i=0; i<n; i++) {
                const px = currentPix[i].x;
                const py = currentPix[i].y;
                const trX = scale * (px * Math.cos(theta) - py * Math.sin(theta)) + transX;
                const trY = scale * (px * Math.sin(theta) + py * Math.cos(theta)) + transY;
                sqErr += (trX - currentProj[i].x)**2 + (trY - currentProj[i].y)**2;
            }
            return Math.sqrt(sqErr / n);
        };

        // Hill Climbing Optimization
        let cx = rotation.x; 
        let cy = rotation.y;
        let cCost = computeRMSE(cx, cy);
        let step = 2.0;
        const minStep = 0.05; // Slightly coarser than main auto-tune for speed

        while (step > minStep) {
            let improved = false;
            const neighbors = [[cx+step, cy], [cx-step, cy], [cx, cy+step], [cx, cy-step]];
            for (const [nx, ny] of neighbors) {
                const cost = computeRMSE(nx, ny);
                if (cost < cCost) {
                    cCost = cost;
                    cx = nx;
                    cy = ny;
                    improved = true;
                    break;
                }
            }
            if (!improved) step /= 2;
        }

        return cCost;
    };

    // 1. Calculate Baseline (All points included)
    const baselineRMSE = getOptimizedRMSE(activeIds);

    // 2. Iterate Leave-One-Out
    let bestSubsetRMSE = baselineRMSE;
    let culpritId = -1;

    // We can iterate all active IDs
    for (const idToRemove of activeIds) {
        const subset = activeIds.filter(id => id !== idToRemove);
        const rmse = getOptimizedRMSE(subset);
        
        if (rmse < bestSubsetRMSE) {
            bestSubsetRMSE = rmse;
            culpritId = idToRemove;
        }
    }

    setIsTuning(false);

    // Threshold: Improvement must be somewhat significant (e.g., > 0.001m or > 5%)
    if (culpritId !== -1 && (baselineRMSE - bestSubsetRMSE) > 0.0001) {
        setOutlierResult({
            worstId: culpritId,
            improvement: baselineRMSE - bestSubsetRMSE,
            originalRmse: baselineRMSE,
            newRmse: bestSubsetRMSE
        });
    } else {
        setOutlierResult(null);
        alert("Optimization analysis shows that removing any single point does not significantly improve the best achievable RMSE. The error is likely distributed or systematic.");
    }
  };

  // --- Auto-Tune Logic (Hill Climbing) ---
  const handleAutoTune = async () => {
      if (evalMode !== EvaluationMode.GLOBAL_ADJUSTMENT) {
          if (selectedGCPIds.length !== 2 || selectedPixelIds.length !== 2) {
              alert("For Alignment or Ratio optimization, please select exactly 2 anchor points in both charts first.");
              return;
          }
      }

      setIsTuning(true);
      await new Promise(r => setTimeout(r, 50));

      const validPixelMap = new Map();
      pixelData.forEach(p => {
          if (!excludedPointIds.includes(p.id)) {
              validPixelMap.set(p.id, pixToMath(p));
          }
      });
      
      const calculateScore = (rx: number, ry: number) => {
          const currentProj = enuPoints.map((enu, i) => {
             const r = rotatePoint(enu, {x: rx, y: ry, z: rotation.z});
             return { id: RAW_GCP_DATA[i].id, x: r.x, y: r.y };
          });

          // MODE: GLOBAL ADJUSTMENT (Least Squares RMSE)
          if (evalMode === EvaluationMode.GLOBAL_ADJUSTMENT) {
              const validPoints: {gcp: {x:number, y:number}, pix: {x:number, y:number}}[] = [];
              currentProj.forEach(p => {
                  if (validPixelMap.has(p.id)) {
                      validPoints.push({ gcp: p, pix: validPixelMap.get(p.id) });
                  }
              });

              if (validPoints.length < 3) return 999999; 

              const cGCP = validPoints.reduce((acc, p) => ({ x: acc.x + p.gcp.x, y: acc.y + p.gcp.y }), {x:0, y:0});
              const cPix = validPoints.reduce((acc, p) => ({ x: acc.x + p.pix.x, y: acc.y + p.pix.y }), {x:0, y:0});
              cGCP.x /= validPoints.length; cGCP.y /= validPoints.length;
              cPix.x /= validPoints.length; cPix.y /= validPoints.length;

              let sum_xX_plus_yY = 0, sum_xY_minus_yX = 0, sum_sq_source = 0;
              validPoints.forEach(p => {
                const sx = p.pix.x - cPix.x, sy = p.pix.y - cPix.y;
                const tx = p.gcp.x - cGCP.x, ty = p.gcp.y - cGCP.y;
                sum_xX_plus_yY += (sx * tx + sy * ty);
                sum_xY_minus_yX += (sx * ty - sy * tx);
                sum_sq_source += (sx * sx + sy * sy);
              });

              const s = Math.sqrt(sum_xX_plus_yY**2 + sum_xY_minus_yX**2) / sum_sq_source;
              const theta = Math.atan2(sum_xY_minus_yX, sum_xX_plus_yY);
              const tx = cGCP.x - s * (cPix.x * Math.cos(theta) - cPix.y * Math.sin(theta));
              const ty = cGCP.y - s * (cPix.x * Math.sin(theta) + cPix.y * Math.cos(theta));

              let sqErr = 0;
              validPoints.forEach(p => {
                  const trX = s * (p.pix.x * Math.cos(theta) - p.pix.y * Math.sin(theta)) + tx;
                  const trY = s * (p.pix.x * Math.sin(theta) + p.pix.y * Math.cos(theta)) + ty;
                  sqErr += (trX - p.gcp.x)**2 + (trY - p.gcp.y)**2;
              });
              return Math.sqrt(sqErr / validPoints.length);
          }

          // MODE: 2-POINT ALIGNMENT
          if (evalMode === EvaluationMode.ALIGNMENT) {
              const idA = selectedGCPIds[0];
              const idB = selectedGCPIds[1];
              const pGCP_A = currentProj.find(p => p.id === idA);
              const pGCP_B = currentProj.find(p => p.id === idB);
              const mPix_A = validPixelMap.get(idA);
              const mPix_B = validPixelMap.get(idB);

              if (!pGCP_A || !pGCP_B || !mPix_A || !mPix_B) return 999999;

              const cGCP = { x: (pGCP_A.x + pGCP_B.x)/2, y: (pGCP_A.y + pGCP_B.y)/2 };
              const cPix = { x: (mPix_A.x + mPix_B.x)/2, y: (mPix_A.y + mPix_B.y)/2 };
              const vGCP = { x: pGCP_B.x - pGCP_A.x, y: pGCP_B.y - pGCP_A.y };
              const vPix = { x: mPix_B.x - mPix_A.x, y: mPix_B.y - mPix_A.y };
              const s = Math.sqrt(vGCP.x**2 + vGCP.y**2) / Math.sqrt(vPix.x**2 + vPix.y**2);
              const theta = Math.atan2(vGCP.y, vGCP.x) - Math.atan2(vPix.y, vPix.x);

              let sqErr = 0;
              let count = 0;
              currentProj.forEach(gcp => {
                  if (excludedPointIds.includes(gcp.id)) return;
                  const mPix = validPixelMap.get(gcp.id);
                  if (mPix) {
                      const dx = mPix.x - cPix.x;
                      const dy = mPix.y - cPix.y;
                      const rx = s * (dx * Math.cos(theta) - dy * Math.sin(theta));
                      const ry = s * (dx * Math.sin(theta) + dy * Math.cos(theta));
                      const tx = rx + cGCP.x;
                      const ty = ry + cGCP.y;
                      sqErr += (tx - gcp.x)**2 + (ty - gcp.y)**2;
                      count++;
                  }
              });
              return count > 0 ? Math.sqrt(sqErr / count) : 999999;
          }

          // MODE: DISTANCE RATIO
          if (evalMode === EvaluationMode.DISTANCE_RATIO) {
              const idA = selectedGCPIds[0];
              const idB = selectedGCPIds[1];
              const pGCP_A = currentProj.find(p => p.id === idA);
              const pGCP_B = currentProj.find(p => p.id === idB);
              const mPix_A = validPixelMap.get(idA);
              const mPix_B = validPixelMap.get(idB);

              if (!pGCP_A || !pGCP_B || !mPix_A || !mPix_B) return 999999;
              const distGCP_Ref = dist2D(pGCP_A, pGCP_B);
              const distPix_Ref = dist2D(mPix_A, mPix_B);
              const scale = distGCP_Ref / distPix_Ref;
              let totalErrorSq = 0;
              let count = 0;

              for (let i = 0; i < currentProj.length; i++) {
                if (excludedPointIds.includes(currentProj[i].id)) continue;
                for (let j = i + 1; j < currentProj.length; j++) {
                    if (excludedPointIds.includes(currentProj[j].id)) continue;
                    const g1 = currentProj[i];
                    const g2 = currentProj[j];
                    const p1 = validPixelMap.get(g1.id);
                    const p2 = validPixelMap.get(g2.id);
                    if (p1 && p2) {
                        const d_real = dist2D(g1, g2);
                        const d_pix = dist2D(p1, p2);
                        const d_calc = d_pix * scale;
                        totalErrorSq += (d_real - d_calc) ** 2;
                        count++;
                    }
                }
              }
              return count > 0 ? totalErrorSq / count : 999999;
          }
          return 999999;
      };

      let currentX = rotation.x;
      let currentY = rotation.y;
      let currentScore = calculateScore(currentX, currentY);
      
      let step = 2.0; 
      let minStep = 0.005; 

      while (step > minStep) {
          let improved = false;
          const neighbors = [
              [currentX + step, currentY],
              [currentX - step, currentY],
              [currentX, currentY + step],
              [currentX, currentY - step],
          ];
          for (const [nx, ny] of neighbors) {
              const score = calculateScore(nx, ny);
              if (score < currentScore) {
                  currentScore = score;
                  currentX = nx;
                  currentY = ny;
                  improved = true;
                  break; 
              }
          }
          if (!improved) step /= 2; 
      }
      setRotation({ x: currentX, y: currentY, z: rotation.z });
      setIsTuning(false);
  };

  const handleToggleExclude = (id: number) => {
    setExcludedPointIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      return [...prev, id];
    });
    setOutlierResult(null);
    if (selectedGCPIds.includes(id)) setSelectedGCPIds(prev => prev.filter(i => i !== id));
    if (selectedPixelIds.includes(id)) setSelectedPixelIds(prev => prev.filter(i => i !== id));
  };

  const handleSelectGCP = (id: number) => {
    if (excludedPointIds.includes(id)) return;
    setSelectedGCPIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
    if (!selectedPixelIds.includes(id) && !excludedPointIds.includes(id)) {
        setSelectedPixelIds(prev => {
           if (prev.includes(id)) return prev.filter(i => i !== id);
           if (prev.length >= 2) return [prev[1], id];
           return [...prev, id];
        });
    }
  };

  const handleSelectPixel = (id: number) => {
    if (excludedPointIds.includes(id)) return;
    setSelectedPixelIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
    if (!selectedGCPIds.includes(id) && !excludedPointIds.includes(id)) {
        setSelectedGCPIds(prev => {
           if (prev.includes(id)) return prev.filter(i => i !== id);
           if (prev.length >= 2) return [prev[1], id];
           return [...prev, id];
        });
    }
  };

  const startEditingPixels = () => {
    const text = pixelData.map(p => `${p.u} ${p.v}`).join('\n');
    setPixelInputText(text);
    setIsEditingPixels(true);
  };

  const savePixelData = () => {
    const lines = pixelInputText.trim().split('\n');
    const newPixels: PixelCoord[] = [];
    lines.forEach((line, idx) => {
      const parts = line.trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const existingId = pixelData[idx]?.id || (idx + 1);
        newPixels.push({ id: existingId, u: parts[0], v: parts[1] });
      }
    });

    if (newPixels.length > 0) {
      setPixelData(newPixels);
      setIsEditingPixels(false);
    } else {
      alert("Invalid format. Please use 'U V' format per line.");
    }
  };

  const resetPixelData = () => {
    setPixelData(RAW_PIXEL_DATA);
    setIsEditingPixels(false);
  };

  // --- Evaluation Logic ---

  const evaluationResult = useMemo(() => {
    if (evalMode === EvaluationMode.GLOBAL_ADJUSTMENT) {
        const validPoints = projectedGCPs
            .filter(g => !excludedPointIds.includes(g.id))
            .map(g => {
                const pix = pixelData.find(p => p.id === g.id);
                return pix ? { gcp: g, pix: pixToMath(pix) } : null;
            })
            .filter(Boolean) as { gcp: ProjectedGCP, pix: {x: number, y: number} }[];

        if (validPoints.length < 2) return null;

        const cGCP = validPoints.reduce((acc, p) => ({ x: acc.x + p.gcp.x, y: acc.y + p.gcp.y }), {x:0, y:0});
        cGCP.x /= validPoints.length;
        cGCP.y /= validPoints.length;

        const cPix = validPoints.reduce((acc, p) => ({ x: acc.x + p.pix.x, y: acc.y + p.pix.y }), {x:0, y:0});
        cPix.x /= validPoints.length;
        cPix.y /= validPoints.length;

        let sum_xX_plus_yY = 0, sum_xY_minus_yX = 0, sum_sq_source = 0;
        validPoints.forEach(p => {
            const src_x = p.pix.x - cPix.x;
            const src_y = p.pix.y - cPix.y;
            const tgt_x = p.gcp.x - cGCP.x;
            const tgt_y = p.gcp.y - cGCP.y;
            sum_xX_plus_yY += (src_x * tgt_x + src_y * tgt_y);
            sum_xY_minus_yX += (src_x * tgt_y - src_y * tgt_x);
            sum_sq_source += (src_x * src_x + src_y * src_y);
        });

        const theta = Math.atan2(sum_xY_minus_yX, sum_xX_plus_yY);
        const s = Math.sqrt(sum_xX_plus_yY**2 + sum_xY_minus_yX**2) / sum_sq_source;
        const tx = cGCP.x - s * (cPix.x * Math.cos(theta) - cPix.y * Math.sin(theta));
        const ty = cGCP.y - s * (cPix.x * Math.sin(theta) + cPix.y * Math.cos(theta));

        let sqErrSum = 0;
        const errorList: any[] = [];
        let count = 0;

        pixelData.forEach(pix => {
             const mPix = pixToMath(pix);
             const transformedX = s * (mPix.x * Math.cos(theta) - mPix.y * Math.sin(theta)) + tx;
             const transformedY = s * (mPix.x * Math.sin(theta) + mPix.y * Math.cos(theta)) + ty;

             const gt = projectedGCPs.find(g => g.id === pix.id);
             if (gt) {
                 const err = Math.sqrt((transformedX - gt.x)**2 + (transformedY - gt.y)**2);
                 if (!excludedPointIds.includes(pix.id)) {
                     sqErrSum += err**2;
                     count++;
                 }
                 errorList.push({
                     id: pix.id,
                     error: err,
                     transformed: { x: transformedX, y: transformedY }
                 });
             }
        });

        const rmse = count > 0 ? Math.sqrt(sqErrSum / count) : 0;

        return {
            type: 'GLOBAL_ADJUSTMENT',
            scale: s,
            rotation: theta,
            translation: { x: tx, y: ty },
            rmse,
            errors: errorList,
            validCount: count
        } as AlignmentResult & { type: string, validCount: number };
    }

    if (selectedGCPIds.length !== 2 || selectedPixelIds.length !== 2) return null;
    
    const idA = selectedGCPIds[0];
    const idB = selectedGCPIds[1];
    
    const pGCP_A = projectedGCPs.find(p => p.id === idA);
    const pGCP_B = projectedGCPs.find(p => p.id === idB);
    const pPix_A = pixelData.find(p => p.id === idA);
    const pPix_B = pixelData.find(p => p.id === idB);

    if (!pGCP_A || !pGCP_B || !pPix_A || !pPix_B) return null;

    const mPix_A = pixToMath(pPix_A);
    const mPix_B = pixToMath(pPix_B);

    if (evalMode === EvaluationMode.ALIGNMENT) {
        const cGCP = { x: (pGCP_A.x + pGCP_B.x)/2, y: (pGCP_A.y + pGCP_B.y)/2 };
        const cPix = { x: (mPix_A.x + mPix_B.x)/2, y: (mPix_A.y + mPix_B.y)/2 };
        const vGCP = { x: pGCP_B.x - pGCP_A.x, y: pGCP_B.y - pGCP_A.y };
        const vPix = { x: mPix_B.x - mPix_A.x, y: mPix_B.y - mPix_A.y };
        const lenGCP = Math.sqrt(vGCP.x**2 + vGCP.y**2);
        const lenPix = Math.sqrt(vPix.x**2 + vPix.y**2);
        const s = lenGCP / lenPix;
        const theta = Math.atan2(vGCP.y, vGCP.x) - Math.atan2(vPix.y, vPix.x);

        let sqErrSum = 0;
        let count = 0;
        const errorList: any[] = [];

        pixelData.forEach(pix => {
            const mPix = pixToMath(pix);
            const dx = mPix.x - cPix.x;
            const dy = mPix.y - cPix.y;
            const rx = s * (dx * Math.cos(theta) - dy * Math.sin(theta));
            const ry = s * (dx * Math.sin(theta) + dy * Math.cos(theta));
            const tx = rx + cGCP.x;
            const ty = ry + cGCP.y;

            const gt = projectedGCPs.find(g => g.id === pix.id);
            if (gt) {
                const err = Math.sqrt((tx - gt.x)**2 + (ty - gt.y)**2);
                if (!excludedPointIds.includes(pix.id)) {
                    sqErrSum += err**2;
                    count++;
                }
                errorList.push({
                    id: pix.id,
                    error: err,
                    transformed: { x: tx, y: ty }
                });
            }
        });

        const rmse = count > 0 ? Math.sqrt(sqErrSum / count) : 0;
        
        return {
            type: 'ALIGNMENT',
            scale: s,
            rotation: theta,
            translation: { x: cGCP.x - cPix.x, y: cGCP.y - cPix.y }, 
            rmse,
            errors: errorList,
            validCount: count
        } as AlignmentResult & { type: string, validCount: number };

    } else {
        const distGCP = dist2D(pGCP_A, pGCP_B);
        const distPix = dist2D({ x: isMirrored ? -pPix_A.u : pPix_A.u, y: pPix_A.v }, { x: isMirrored ? -pPix_B.u : pPix_B.u, y: pPix_B.v });
        const scale = distGCP / distPix; 
        const errors: any[] = [];
        let totalPct = 0;
        let count = 0;

        for (let i = 0; i < projectedGCPs.length; i++) {
            if (excludedPointIds.includes(projectedGCPs[i].id)) continue;
            for (let j = i + 1; j < projectedGCPs.length; j++) {
                if (excludedPointIds.includes(projectedGCPs[j].id)) continue;
                const g1 = projectedGCPs[i];
                const g2 = projectedGCPs[j];
                const p1 = pixelData.find(p => p.id === g1.id);
                const p2 = pixelData.find(p => p.id === g2.id);
                if (p1 && p2) {
                    const d_real = dist2D(g1, g2);
                    const d_pix = dist2D({x: isMirrored ? -p1.u : p1.u, y: p1.v}, {x: isMirrored ? -p2.u : p2.u, y: p2.v});
                    const d_calc = d_pix * scale;
                    const diff = Math.abs(d_real - d_calc);
                    const pct = d_real !== 0 ? (diff / d_real) * 100 : 0;
                    totalPct += pct;
                    count++;
                    errors.push({
                        pair: [g1.id, g2.id],
                        pixelDistance: d_pix,
                        projectedDistance: d_real,
                        calculatedDistance: d_calc,
                        diff,
                        percentError: pct
                    });
                }
            }
        }

        return {
            type: 'RATIO',
            baseScale: scale,
            errors,
            meanPercentError: count > 0 ? totalPct / count : 0,
            validCount: count
        } as RatioResult & { type: string, validCount: number };
    }

  }, [projectedGCPs, selectedGCPIds, selectedPixelIds, evalMode, pixelData, excludedPointIds, isMirrored, pixToMath]);

  const overlayData = useMemo(() => {
    if (!evaluationResult || evaluationResult.type === 'RATIO') return undefined;
    const res = evaluationResult as AlignmentResult;
    return res.errors.map(e => ({
        id: e.id,
        x: e.transformed.x,
        y: e.transformed.y
    }));
  }, [evaluationResult]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Calculator className="text-blue-600" size={24}/>
                TDOM-GCP Quantitative Evaluator
            </h1>
          </div>
          
          <div className="flex gap-4 items-center">
            <button
                onClick={() => setIsExcludeMode(!isExcludeMode)}
                className={clsx(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all shadow-sm border",
                    isExcludeMode 
                        ? "bg-red-50 text-red-700 border-red-200 ring-2 ring-red-500/20" 
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                )}
            >
                {isExcludeMode ? <Ban size={16}/> : <MousePointer2 size={16}/>}
                {isExcludeMode ? "Exclusion Mode ON" : "Select / Normal"}
            </button>
            <div className="px-4 py-2 bg-slate-100 rounded-lg border border-slate-200 text-xs text-slate-600 font-mono shadow-inner hidden md:block">
              <div className="flex gap-4">
                <span>Total: <strong className="text-slate-900">{RAW_GCP_DATA.length}</strong></span>
                <span>Active: <strong className="text-emerald-600">{RAW_GCP_DATA.length - excludedPointIds.length}</strong></span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <RotationControl 
            rotation={rotation} 
            onChange={setRotation} 
            onResetNorth={handleResetNorth}
            onResetVertical={handleResetVertical}
            onAutoTune={handleAutoTune}
            isTuning={isTuning}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-[550px]">
                <ScatterPlot 
                title="Projected GCP Plane (XY Meters)" 
                data={projectedGCPs.map(p => ({id: p.id, x: p.x, y: p.y}))}
                overlayData={overlayData} 
                selectedIds={selectedGCPIds}
                excludedIds={excludedPointIds}
                onSelect={handleSelectGCP}
                onToggleExclude={handleToggleExclude}
                isExcludeMode={isExcludeMode}
                color="#3b82f6"
                xAxisLabel="East / X (m)"
                yAxisLabel="North / Y (m)"
                />
            </div>
            
            <div className="relative group h-[550px]">
                {isEditingPixels ? (
                    <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm h-full flex flex-col">
                         <div className="flex justify-between items-center mb-2">
                             <h3 className="text-slate-700 font-semibold">Edit Pixel Coordinates</h3>
                             <div className="flex gap-2">
                                <button onClick={resetPixelData} className="p-1 hover:bg-slate-100 rounded text-slate-500" title="Reset Default"><RotateCcw size={14}/></button>
                                <button onClick={savePixelData} className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 flex items-center gap-1"><Save size={14}/> Save</button>
                             </div>
                         </div>
                         <textarea 
                            className="w-full flex-grow bg-slate-50 border border-slate-200 rounded p-2 font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                            value={pixelInputText}
                            onChange={e => setPixelInputText(e.target.value)}
                            placeholder="U V (one pair per line)"
                         />
                         <p className="text-xs text-slate-400 mt-2">Enter U and V separated by spaces. Lines assume ID 1..N order.</p>
                    </div>
                ) : (
                    <>
                        <div className="absolute top-14 right-4 z-10 flex flex-col gap-2">
                            <button 
                                onClick={startEditingPixels}
                                className="p-2 bg-white/80 hover:bg-white text-slate-600 hover:text-blue-600 rounded-full shadow-sm border border-slate-200 transition-colors"
                                title="Edit Pixel Data"
                            >
                                <Edit size={16} />
                            </button>
                            <button 
                                onClick={() => setIsMirrored(!isMirrored)}
                                className={clsx(
                                    "p-2 rounded-full shadow-sm border transition-colors",
                                    isMirrored ? "bg-blue-600 text-white border-blue-700" : "bg-white/80 hover:bg-white text-slate-600 hover:text-blue-600 border-slate-200"
                                )}
                                title="Flip X Axis (Mirror Image)"
                            >
                                <ArrowLeftRight size={16} />
                            </button>
                        </div>
                        <ScatterPlot 
                        title="TDOM Pixel Coordinates" 
                        data={scatterPixelData}
                        selectedIds={selectedPixelIds}
                        excludedIds={excludedPointIds}
                        onSelect={handleSelectPixel}
                        onToggleExclude={handleToggleExclude}
                        isExcludeMode={isExcludeMode}
                        color="#10b981"
                        xAxisLabel={isMirrored ? "U (px) [Mirrored]" : "U (px)"}
                        yAxisLabel="V (px)"
                        flipY={true}
                        />
                    </>
                )}
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-lg flex items-start gap-3 shadow-sm">
             <AlertCircle className="text-indigo-500 shrink-0 mt-0.5" size={18} />
             <div className="text-xs text-indigo-900 flex flex-col gap-1">
                <strong>How to evaluate:</strong>
                <ol className="list-decimal pl-4 space-y-1">
                    <li>Use <strong>Exclusion Mode</strong> (top right) to toggle outlier points ON/OFF.</li>
                    <li>For <strong>Alignment/Ratio</strong>: Select exactly 2 points in both charts (e.g. 1 & 2).</li>
                    <li>For <strong>Global Adjustment</strong>: No selection needed; uses all active points.</li>
                    <li><strong>Overlay Analysis</strong>: Check the Left Plot. <span className="text-red-500 font-bold">Red lines</span> show residual errors. Use the scale slider to magnify them.</li>
                    <li>If points are mirrored, use the <ArrowLeftRight className="inline" size={12}/> button on the Pixel Plot.</li>
                </ol>
             </div>
          </div>

        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xl shadow-slate-200/50 sticky top-24">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col gap-3">
                <div className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
                    <Calculator size={16} />
                    <h2>Results & Evaluation Mode</h2>
                </div>
                <div className="flex bg-slate-200/50 rounded-lg p-1 border border-slate-200 gap-0.5">
                    <button 
                        onClick={() => setEvalMode(EvaluationMode.ALIGNMENT)}
                        className={clsx(
                            "flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all uppercase tracking-wide flex items-center justify-center gap-1",
                            evalMode === EvaluationMode.ALIGNMENT ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                        title="Align using 2 anchors"
                    >
                        <GitCompare size={12} />
                        2-Pt Align
                    </button>
                    <button 
                        onClick={() => setEvalMode(EvaluationMode.GLOBAL_ADJUSTMENT)}
                        className={clsx(
                            "flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all uppercase tracking-wide flex items-center justify-center gap-1",
                            evalMode === EvaluationMode.GLOBAL_ADJUSTMENT ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                        title="Least Squares Adjustment"
                    >
                        <Globe size={12} />
                        Global Adj
                    </button>
                    <button 
                        onClick={() => setEvalMode(EvaluationMode.DISTANCE_RATIO)}
                        className={clsx(
                            "flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all uppercase tracking-wide flex items-center justify-center gap-1",
                            evalMode === EvaluationMode.DISTANCE_RATIO ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                        title="Relative Length Ratio"
                    >
                        <Scale size={12} />
                        Ratio
                    </button>
                </div>
            </div>

            <div className="p-6 bg-white min-h-[400px]">
                {/* Outlier Detection Tool */}
                <div className="mb-6 p-3 bg-amber-50 rounded-lg border border-amber-100">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">Outlier Detection</span>
                        {outlierResult && (
                            <button onClick={() => setOutlierResult(null)} className="text-amber-400 hover:text-amber-600">
                                <XCircle size={14} />
                            </button>
                        )}
                    </div>
                    {outlierResult ? (
                         <div className="text-xs space-y-2">
                            <p className="text-amber-900">
                                Likely outlier: <strong>Point {outlierResult.worstId}</strong>
                            </p>
                            <div className="flex items-center gap-2 font-mono text-slate-600 bg-white/50 p-1 rounded border border-amber-200/50">
                                <span>RMSE: {outlierResult.originalRmse.toFixed(6)}m</span>
                                <ArrowRight size={10} />
                                <span className="text-emerald-600 font-bold">{outlierResult.newRmse.toFixed(6)}m</span>
                            </div>
                            <p className="text-amber-700/80 italic text-[10px]">
                                Removing Point {outlierResult.worstId} improves <strong>Auto-Tuned</strong> accuracy by {outlierResult.improvement.toFixed(6)}m.
                            </p>
                            <button 
                                onClick={() => handleToggleExclude(outlierResult.worstId)}
                                className="w-full mt-1 bg-amber-100 hover:bg-amber-200 text-amber-900 py-1 rounded border border-amber-200 transition-colors"
                            >
                                Exclude Point {outlierResult.worstId}
                            </button>
                         </div>
                    ) : (
                        <button 
                            onClick={handleDetectOutlier}
                            disabled={isTuning}
                            className="w-full flex items-center justify-center gap-2 bg-white hover:bg-amber-100 text-amber-700 border border-amber-200 py-2 rounded text-xs font-medium transition-all shadow-sm disabled:opacity-50"
                        >
                            <ScanEye size={14} />
                            {isTuning ? "Analyzing..." : "Detect Largest Deviant"}
                        </button>
                    )}
                </div>

                {!evaluationResult ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4 pt-8">
                        <CheckCircle2 size={64} strokeWidth={1} />
                        <p className="text-slate-400 font-medium text-center text-sm">
                            {evalMode === EvaluationMode.GLOBAL_ADJUSTMENT 
                                ? "Ensure at least 2 active points exist." 
                                : "Select 2 points in both plots."}
                            <br/>
                            <span className="text-slate-300 text-xs">Ensure anchors are not excluded.</span>
                        </p>
                    </div>
                ) : (evaluationResult.type === 'ALIGNMENT' || evaluationResult.type === 'GLOBAL_ADJUSTMENT') ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {evaluationResult.type === 'GLOBAL_ADJUSTMENT' && (
                            <div className="bg-emerald-50 text-emerald-800 text-xs p-2 rounded border border-emerald-100 flex items-center gap-2">
                                <Globe size={14} />
                                Global Least Squares Fit (Helmert)
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                             <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <span className="text-slate-500 text-[10px] block mb-1 font-bold uppercase tracking-wider">RMSE (Active)</span>
                                <span className="text-xl font-bold text-slate-900 font-mono">
                                    {(evaluationResult as AlignmentResult).rmse.toFixed(6)} <span className="text-xs font-normal text-slate-500">m</span>
                                </span>
                             </div>
                             <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <span className="text-slate-500 text-[10px] block mb-1 font-bold uppercase tracking-wider">Scale Factor</span>
                                <span className="text-lg font-bold text-blue-600 font-mono">
                                    {(evaluationResult as AlignmentResult).scale.toFixed(6)} <span className="text-xs font-normal text-slate-500">m/px</span>
                                </span>
                             </div>
                        </div>

                        <div>
                            <h3 className="text-xs font-bold text-slate-700 mb-3 border-b border-slate-100 pb-2 flex justify-between">
                                <span>Per-Point Residuals</span>
                                <span className="font-normal text-slate-400">{ (evaluationResult as any).validCount } points evaluated</span>
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left">
                                    <thead className="text-slate-400 bg-slate-50/50">
                                        <tr>
                                            <th className="pb-2 pt-2 pl-2 rounded-l">ID</th>
                                            <th className="pb-2 pt-2 text-right">Error (m)</th>
                                            <th className="pb-2 pt-2 text-right pr-2 rounded-r">Shift (X, Y)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(evaluationResult as AlignmentResult).errors.map((err) => {
                                            const isAnchor = selectedGCPIds.includes(err.id) && evalMode === EvaluationMode.ALIGNMENT;
                                            const original = projectedGCPs.find(p => p.id === err.id);
                                            const isExcluded = excludedPointIds.includes(err.id);
                                            const isLargeError = !isAnchor && !isExcluded && err.error > (evaluationResult as AlignmentResult).rmse;

                                            return (
                                                <tr key={err.id} className={clsx(
                                                    "hover:bg-slate-50 transition-colors", 
                                                    isAnchor && "bg-blue-50/50",
                                                    isExcluded && "opacity-40 bg-slate-50"
                                                )}>
                                                    <td className="py-2 pl-2 font-medium text-slate-700">
                                                        {err.id} {isAnchor && <span className="text-[9px] text-blue-500 ml-1 font-bold border border-blue-200 px-1 rounded bg-white">REF</span>}
                                                    </td>
                                                    <td className={clsx(
                                                        "py-2 text-right font-mono font-bold",
                                                        isExcluded ? "text-slate-400 italic" : (isLargeError ? "text-amber-600" : "text-emerald-600")
                                                    )}>
                                                        {isExcluded ? "Excluded" : err.error.toFixed(6)}
                                                    </td>
                                                    <td className="py-2 text-right pr-2 font-mono text-slate-400">
                                                        { original ? (err.transformed.x - original.x).toFixed(6) : 0 }, 
                                                        { original ? (err.transformed.y - original.y).toFixed(6) : 0 }
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                         <div className="grid grid-cols-2 gap-3">
                             <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <span className="text-slate-500 text-[10px] block mb-1 font-bold uppercase tracking-wider">Mean % Error</span>
                                <span className="text-xl font-bold text-slate-900 font-mono">
                                    {(evaluationResult as RatioResult).meanPercentError.toFixed(6)}%
                                </span>
                             </div>
                             <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                                <span className="text-slate-500 text-[10px] block mb-1 font-bold uppercase tracking-wider">Base Scale</span>
                                <span className="text-lg font-bold text-blue-600 font-mono">
                                    {(evaluationResult as RatioResult).baseScale.toFixed(6)} <span className="text-xs font-normal text-slate-500">m/px</span>
                                </span>
                             </div>
                        </div>

                         <div>
                            <h3 className="text-xs font-bold text-slate-700 mb-3 border-b border-slate-100 pb-2">Pairwise Error (Valid Points Only)</h3>
                             <div className="overflow-y-auto max-h-[400px]">
                                <table className="w-full text-xs text-left">
                                    <thead className="text-slate-400 bg-slate-50/50 sticky top-0 shadow-sm z-10">
                                        <tr>
                                            <th className="pb-2 pt-2 pl-2 bg-slate-50">Pair</th>
                                            <th className="pb-2 pt-2 text-right bg-slate-50">Diff (m)</th>
                                            <th className="pb-2 pt-2 text-right pr-2 bg-slate-50">% Err</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(evaluationResult as RatioResult).errors.map((err, idx) => {
                                            const isBasePair = (selectedGCPIds.includes(err.pair[0]) && selectedGCPIds.includes(err.pair[1]));
                                            if (isBasePair) return null; 
                                            return (
                                                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                    <td className="py-2 pl-2 font-medium text-slate-700">
                                                        {err.pair[0]}-{err.pair[1]}
                                                    </td>
                                                    <td className="py-2 text-right font-mono text-slate-500">
                                                        {err.diff.toFixed(6)}
                                                    </td>
                                                    <td className={clsx("py-2 text-right pr-2 font-mono font-bold", err.percentError > 1.0 ? "text-amber-500" : "text-emerald-600")}>
                                                        {err.percentError.toFixed(6)}%
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
