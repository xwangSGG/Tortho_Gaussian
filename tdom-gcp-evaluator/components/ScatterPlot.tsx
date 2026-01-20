
import React, { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, Layers, Maximize2 } from 'lucide-react';

interface ScatterPlotProps {
  data: { id: number; x: number; y: number; label?: string }[];
  overlayData?: { id: number; x: number; y: number }[]; // Transformed points for comparison
  selectedIds: number[];
  excludedIds: number[];
  onSelect: (id: number) => void;
  onToggleExclude: (id: number) => void;
  isExcludeMode: boolean;
  color: string;
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  flipY?: boolean;
}

const ScatterPlot: React.FC<ScatterPlotProps> = ({ 
  data, 
  overlayData,
  selectedIds, 
  excludedIds,
  onSelect, 
  onToggleExclude,
  isExcludeMode,
  color, 
  title,
  xAxisLabel,
  yAxisLabel,
  flipY = false
}) => {
  const [zoom, setZoom] = useState(1);
  const [showOverlay, setShowOverlay] = useState(true);
  const [residualScale, setResidualScale] = useState(1); // Magnification factor for error vectors

  // Base dimensions for the SVG coordinate system
  const width = 800;
  const height = 700;

  // Calculate bounds and unified scale considering BOTH data and overlayData
  const transform = useMemo(() => {
    if (data.length === 0) return { scale: 1, offsetX: 0, offsetY: 0, centerX: 0, centerY: 0 };
    
    let allPoints = [...data];
    // Do NOT include magnified overlay points in bounds calculation, or it will zoom out too much
    // We only fit the actual GCPs and the "True" transformed pixels (scale=1)
    if (overlayData && showOverlay) {
        allPoints = [...allPoints, ...overlayData];
    }

    const xs = allPoints.map(d => d.x);
    const ys = allPoints.map(d => d.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const rangeX = maxX - minX || 10;
    const rangeY = maxY - minY || 10;
    
    // Add padding
    const padding = Math.max(rangeX, rangeY) * 0.1;
    const dataMinX = minX - padding;
    const dataMaxX = maxX + padding;
    const dataMinY = minY - padding;
    const dataMaxY = maxY + padding;

    const dataRangeX = dataMaxX - dataMinX;
    const dataRangeY = dataMaxY - dataMinY;

    // Unified Scale (Equal Aspect Ratio)
    // We fit the largest dimension into the view
    const scaleX = width / dataRangeX;
    const scaleY = height / dataRangeY;
    const scale = Math.min(scaleX, scaleY);

    // Center the plot
    const centerX = (dataMinX + dataMaxX) / 2;
    const centerY = (dataMinY + dataMaxY) / 2;

    return { scale, centerX, centerY };
  }, [data, overlayData, showOverlay]);

  // Apply zoom
  const currentScale = transform.scale * zoom;

  // Coordinate mapping functions
  const finalToScreenX = (x: number) => (x - transform.centerX) * currentScale + (width / 2);
  const finalToScreenY = (y: number) => {
      const centeredY = (y - transform.centerY) * currentScale;
      // If flipY (Image coordinates), Y increases Downwards: Center + Y
      // If !flipY (Cartesian/Meters), Y increases Upwards: Center - Y
      return flipY ? ((height / 2) + centeredY) : ((height / 2) - centeredY);
  };

  const handlePointClick = (id: number) => {
    if (isExcludeMode) {
      onToggleExclude(id);
    } else {
      if (!excludedIds.includes(id)) {
        onSelect(id);
      }
    }
  };

  return (
    <div className="flex flex-col items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm h-full">
      <div className="flex justify-between items-center w-full mb-2">
        <h3 className="text-slate-700 font-semibold">{title}</h3>
        
        <div className="flex gap-2 items-center">
            {/* Overlay Controls */}
            {overlayData && overlayData.length > 0 && (
                <>
                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 mr-2" title="Magnify Residual Errors">
                    <Maximize2 size={12} className="text-slate-400" />
                    <input 
                        type="range" 
                        min="1" max="50" step="1" 
                        value={residualScale}
                        onChange={(e) => setResidualScale(Number(e.target.value))}
                        className="w-16 h-1 accent-red-500 cursor-pointer"
                    />
                    <span className="text-[10px] w-6 text-right font-mono text-slate-500">{residualScale}x</span>
                </div>

                <button
                    onClick={() => setShowOverlay(!showOverlay)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors border ${showOverlay ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                    title="Toggle Comparison Overlay"
                >
                    <Layers size={14} />
                    {showOverlay ? "Hide" : "Show"}
                </button>
                </>
            )}

            {/* Zoom Controls */}
            <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1 ml-2">
            <button 
                onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                className="p-1 hover:bg-white rounded shadow-sm transition-all text-slate-500 hover:text-blue-600"
                title="Zoom Out"
            >
                <ZoomOut size={16} />
            </button>
            <span className="text-xs font-mono w-10 text-center text-slate-600">{(zoom * 100).toFixed(0)}%</span>
            <button 
                onClick={() => setZoom(z => Math.min(5, z + 0.25))}
                className="p-1 hover:bg-white rounded shadow-sm transition-all text-slate-500 hover:text-blue-600"
                title="Zoom In"
            >
                <ZoomIn size={16} />
            </button>
            </div>
        </div>
      </div>

      <div className="relative border border-slate-200 bg-slate-50 rounded shadow-inner w-full flex-grow flex justify-center overflow-hidden">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="overflow-visible">
          {/* Grid lines (Center Cross) */}
          <line x1={0} y1={height/2} x2={width} y2={height/2} stroke="#e2e8f0" strokeWidth="1" />
          <line x1={width/2} y1={0} x2={width/2} y2={height} stroke="#e2e8f0" strokeWidth="1" />
          
          {/* Border */}
          <rect x="0" y="0" width={width} height={height} fill="none" stroke="#e2e8f0" strokeWidth="1"/>

          {/* GCP Points - Drawn FIRST so Overlay is ON TOP */}
          {data.map((point) => {
            const isSelected = selectedIds.includes(point.id);
            const isExcluded = excludedIds.includes(point.id);
            
            const nx = finalToScreenX(point.x);
            const ny = finalToScreenY(point.y);
            
            // Basic culling for points far outside view
            if (nx < -50 || nx > width + 50 || ny < -50 || ny > height + 50) return null;

            return (
              <g 
                key={point.id} 
                onClick={() => handlePointClick(point.id)}
                className={`transition-all duration-200 ${isExcluded && !isExcludeMode ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
              >
                {/* Hit area */}
                <circle cx={nx} cy={ny} r={25} fill="transparent" />
                
                {/* Visual Representation */}
                {isExcluded ? (
                   // Excluded: Gray X mark
                   <g stroke="#94a3b8" strokeWidth="3">
                      <line x1={nx-6} y1={ny-6} x2={nx+6} y2={ny+6} />
                      <line x1={nx+6} y1={ny-6} x2={nx-6} y2={ny+6} />
                   </g>
                ) : (
                  <>
                    <circle 
                      cx={nx} 
                      cy={ny} 
                      r={isSelected ? 10 : 6} 
                      fill={isSelected ? '#f59e0b' : color} 
                      stroke={isSelected ? '#fff' : 'none'}
                      strokeWidth={2}
                      className="transition-all duration-200"
                      style={{ filter: isSelected ? 'drop-shadow(0 0 3px rgba(0,0,0,0.4))' : 'none' }}
                    />
                    <text 
                      x={nx + 12} 
                      y={ny - 12} 
                      fill={isSelected ? '#d97706' : "#64748b"} 
                      fontSize="16" 
                      fontWeight={isSelected ? "bold" : "normal"}
                      className="pointer-events-none select-none font-mono"
                      style={{ textShadow: '1px 1px 0 #fff, -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff' }}
                    >
                      {point.label || point.id}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Residual Lines & Magnified Points (Comparison) - Drawn LAST to be ON TOP */}
          {showOverlay && overlayData && data.map(point => {
              if (excludedIds.includes(point.id)) return null;
              const overlayPoint = overlayData.find(op => op.id === point.id);
              if (!overlayPoint) return null;

              const x1 = finalToScreenX(point.x);
              const y1 = finalToScreenY(point.y);
              
              // Calculate Vector Scale
              // The vector direction is (Overlay - Point)
              // If scale > 1, we draw the "Visual" overlay point further away
              const dx = overlayPoint.x - point.x;
              const dy = overlayPoint.y - point.y;
              
              const visualOverlayX = point.x + dx * residualScale;
              const visualOverlayY = point.y + dy * residualScale;

              const x2 = finalToScreenX(visualOverlayX);
              const y2 = finalToScreenY(visualOverlayY);

              return (
                  <g key={`res-group-${point.id}`} className="pointer-events-none">
                      {/* Line from GCP to Transformed Pixel */}
                      <line 
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="#ef4444" 
                        strokeWidth="1.5" 
                        strokeDasharray={residualScale > 1 ? "none" : "4,2"}
                        opacity="0.6"
                      />
                      
                      {/* Transformed Pixel Point (Visual) - LARGER RED CROSS */}
                      <g>
                        {/* Enlarged Cross: +/- 8px (Total 16px size), Stroke 3px */}
                        <line x1={x2-8} y1={y2-8} x2={x2+8} y2={y2+8} stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
                        <line x1={x2+8} y1={y2-8} x2={x2-8} y2={y2+8} stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
                      </g>
                  </g>
              );
          })}
          
          {/* Connecting line for selected pair (Anchors) */}
          {selectedIds.length === 2 && 
           !excludedIds.includes(selectedIds[0]) && 
           !excludedIds.includes(selectedIds[1]) && 
           data.find(p => p.id === selectedIds[0]) && 
           data.find(p => p.id === selectedIds[1]) && (
             <line 
                x1={finalToScreenX(data.find(p => p.id === selectedIds[0])!.x)}
                y1={finalToScreenY(data.find(p => p.id === selectedIds[0])!.y)}
                x2={finalToScreenX(data.find(p => p.id === selectedIds[1])!.x)}
                y2={finalToScreenY(data.find(p => p.id === selectedIds[1])!.y)}
                stroke="#f59e0b"
                strokeWidth="2"
                strokeDasharray="8,4"
                className="pointer-events-none opacity-60"
             />
          )}

        </svg>
      </div>
      <div className="flex justify-between w-full text-xs text-slate-500 mt-2 px-2 font-mono">
        <span>{xAxisLabel}</span>
        
        {/* Legend */}
        {showOverlay && overlayData && (
            <div className="flex gap-3">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> GCP (Truth)</span>
                <span className="flex items-center gap-1"><span className="text-red-500 font-bold text-lg leading-none">×</span> Transformed Pixel</span>
                {residualScale > 1 && <span className="text-red-400 italic">Error Magnified {residualScale}x</span>}
            </div>
        )}

        <span>{yAxisLabel}</span>
      </div>
    </div>
  );
};

export default ScatterPlot;
