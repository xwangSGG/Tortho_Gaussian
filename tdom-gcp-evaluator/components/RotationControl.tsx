
import React, { useState, useEffect } from 'react';
import { RotateCw, ArrowUp, Compass, Wand2, Loader2 } from 'lucide-react';
import { RotationState } from '../types';

interface RotationControlProps {
  rotation: RotationState;
  onChange: (r: RotationState) => void;
  onResetNorth: () => void;
  onResetVertical: () => void;
  onAutoTune: () => void;
  isTuning: boolean;
}

const RotationControl: React.FC<RotationControlProps> = ({ rotation, onChange, onResetNorth, onResetVertical, onAutoTune, isTuning }) => {
  // Local state for DMS inputs to allow typing freely before parsing
  const [dmsInputs, setDmsInputs] = useState({
    x: rotation.x.toFixed(4),
    y: rotation.y.toFixed(4),
    z: rotation.z.toFixed(4)
  });

  // Sync when props change externally
  useEffect(() => {
    setDmsInputs({
      x: rotation.x.toFixed(4),
      y: rotation.y.toFixed(4),
      z: rotation.z.toFixed(4)
    });
  }, [rotation]);

  const handleInputChange = (axis: keyof RotationState, value: string) => {
    setDmsInputs(prev => ({ ...prev, [axis]: value }));
    const num = parseFloat(value);
    if (!isNaN(num)) {
      onChange({ ...rotation, [axis]: num });
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2 text-slate-700 font-semibold">
            <RotateCw size={18} />
            <h2>Projection Plane Orientation (XYZ)</h2>
        </div>
        <button 
          onClick={onAutoTune}
          disabled={isTuning}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded transition-all shadow-sm font-medium
            ${isTuning ? 'bg-purple-100 text-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700 text-white animate-pulse-slow'}
          `}
          title="Automatically fine-tune X/Y angles to minimize RMSE"
        >
          {isTuning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {isTuning ? 'Optimizing...' : 'Auto-Tune'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {['x', 'y', 'z'].map((axis) => (
          <div key={axis} className="flex flex-col gap-1">
            <label className="text-xs uppercase text-slate-500 font-mono tracking-wider">Rotate {axis.toUpperCase()} (°)</label>
            <input
              type="text"
              value={dmsInputs[axis as keyof RotationState]}
              onChange={(e) => handleInputChange(axis as keyof RotationState, e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded p-2 text-sm text-right font-mono focus:ring-2 focus:ring-blue-500 outline-none text-slate-800"
              placeholder="0.00 or DMS"
            />
            <input 
              type="range"
              min="-180"
              max="180"
              step="0.01"
              value={rotation[axis as keyof RotationState]}
              onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  onChange({...rotation, [axis]: val});
              }}
              className="h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button 
          onClick={onResetVertical}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded transition-colors shadow-sm"
        >
          <ArrowUp size={14} />
          Align Z Vertical (Down)
        </button>
        <button 
          onClick={onResetNorth}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded transition-colors shadow-sm"
        >
          <Compass size={14} />
          Align Z North
        </button>
      </div>
      <p className="text-[10px] text-slate-400 mt-2 italic">
        * Rotations are applied to the Local Tangent Plane (Centroid). 
        Z-axis aligns with the desired "Up/Normal" vector before projection to XY.
      </p>
    </div>
  );
};

export default RotationControl;
