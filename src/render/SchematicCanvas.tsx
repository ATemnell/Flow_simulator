import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { pipePoints } from '../model/geometry';
import type { Schematic, Vec } from '../model/types';
import { ComponentView } from './ComponentView';
import { PipeView } from './PipeView';
import { theme } from './theme';

const GRID = 10;

interface View {
  x: number;
  y: number;
  scale: number; // screen px per mm
}

/** Static SVG view of a schematic with wheel-zoom (about the cursor) and drag-to-pan. */
export function SchematicCanvas({ schematic }: { schematic: Schematic }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1.6 });
  const drag = useRef<{ start: Vec; origin: Vec } | null>(null);

  const pipes = useMemo(
    () =>
      schematic.pipes.map((p) => {
        try {
          return { p, pts: pipePoints(schematic, p) };
        } catch {
          return null;
        }
      }),
    [schematic],
  );

  // Fit the view to the schematic whenever a different schematic is loaded.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || schematic.components.length === 0) return;
    const pts = [...schematic.components.map((c) => c.pos), ...pipes.flatMap((e) => e?.pts ?? [])];
    const pad = 70;
    const minX = Math.min(...pts.map((p) => p.x)) - pad;
    const maxX = Math.max(...pts.map((p) => p.x)) + pad;
    const minY = Math.min(...pts.map((p) => p.y)) - pad;
    const maxY = Math.max(...pts.map((p) => p.y)) + pad;
    const { width, height } = svg.getBoundingClientRect();
    const scale = Math.min(4, Math.max(0.25, Math.min(width / (maxX - minX), height / (maxY - minY))));
    setView({ scale, x: (minX + maxX) / 2 - width / 2 / scale, y: (minY + maxY) / 2 - height / 2 / scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schematic]);

  const onWheel =(e: WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setView((v) => {
      const scale = Math.min(8, Math.max(0.25, v.scale * Math.exp(-e.deltaY * 0.0015)));
      // Keep the world point under the cursor fixed.
      const wx = v.x + sx / v.scale;
      const wy = v.y + sy / v.scale;
      return { scale, x: wx - sx / scale, y: wy - sy / scale };
    });
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: { x: view.x, y: view.y } };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.origin.x - (e.clientX - d.start.x) / v.scale, y: d.origin.y - (e.clientY - d.start.y) / v.scale }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={0.6} fill={theme.grid} />
        </pattern>
      </defs>
      <g transform={`scale(${view.scale}) translate(${-view.x} ${-view.y})`}>
        <rect x={view.x - GRID} y={view.y - GRID} width={4000 / view.scale + 2 * GRID} height={4000 / view.scale + 2 * GRID} fill="url(#grid)" />
        {pipes.map((e) => e && <PipeView key={e.p.id} id={e.p.id} points={e.pts} innerDiameter_mm={e.p.innerDiameter_mm} />)}
        {schematic.components.map((c) => (
          <ComponentView key={c.id} c={c} />
        ))}
      </g>
    </svg>
  );
}
