import { estimate } from './model.mjs';

const palette = [[55, 41, 97], [54, 95, 163], [40, 177, 155], [245, 220, 115]];
const locale = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
const gridCache = new WeakMap();

export function viewport(width, height, floor) {
  const { background } = floor;
  const planW = background?.crop.width ?? floor.width;
  const planH = background?.crop.height ?? floor.height;
  const scale = Math.min((width - 60) / planW, (height - 58) / planH);
  const w = planW * scale, h = planH * scale;
  return { left: (width - w) / 2, top: (height - h) / 2, w, h };
}

export function canvasPoint(canvas, e, floor) {
  const rect = canvas.getBoundingClientRect();
  const view = viewport(rect.width, rect.height, floor);
  const x = (e.clientX - rect.left - view.left) / view.w;
  const y = (e.clientY - rect.top - view.top) / view.h;
  const tolerance = Math.min(0.06, 7 / Math.min(view.w, view.h));
  if (x < -tolerance || x > 1 + tolerance || y < -tolerance || y > 1 + tolerance) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

export function hitTest(floor, hit, canvas, router) {
  const { width, height } = canvas.getBoundingClientRect();
  const view = viewport(width, height, floor);
  const px = (a, b) => ({ x: a.x / floor.width * view.w - b.x / floor.width * view.w,
    y: a.y / floor.height * view.h - b.y / floor.height * view.h });
  const near = (a, b) => { const offset = px(a, b); return Math.hypot(offset.x, offset.y); };
  if (router && near(router, hit) <= 21) return { kind: 'router', id: 'router' };
  const point = floor.points.map(p => [p, near(p, hit)]).sort((a, b) => a[1] - b[1])[0];
  if (point?.[1] <= 21) return { kind: 'point', id: point[0].id };
  let best = null;
  let radius = 16;
  for (const wall of floor.walls) {
    const v = px(wall.b, wall.a);
    const offset = px(hit, wall.a);
    const t = Math.max(0, Math.min(1, (v.x * offset.x + v.y * offset.y) / (v.x * v.x + v.y * v.y)));
    const d = Math.hypot(offset.x - t * v.x, offset.y - t * v.y);
    if (d < radius) { best = { kind: 'wall', id: wall.id }; radius = d; }
  }
  return best;
}

function color(value, opacity) {
  const n = Math.max(0, Math.min(1, (value + 90) / 55)) * (palette.length - 1);
  const k = Math.min(palette.length - 2, Math.floor(n));
  const rgb = palette[k].map((channel, i) => Math.round(channel + (palette[k + 1][i] - channel) * (n - k)));
  return `rgba(${rgb.join(',')},${opacity})`;
}

function line(ctx, a, b, paint, width) {
  ctx.strokeStyle = paint;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function paintGrid(ctx, view, dividedX, dividedY, floor) {
  const { left, top, w, h } = view;
  const step = Math.max(1, Math.ceil(Math.max(floor.width, floor.height) / 20));
  for (let x = step; x < floor.width; x += step) {
    const pos = left + x * dividedX;
    line(ctx, {x: pos, y: top}, {x: pos, y: top + h}, '#2a4056', 1);
  }
  for (let y = step; y < floor.height; y += step) {
    const pos = top + y * dividedY;
    line(ctx, {x: left, y: pos}, {x: left + w, y: pos}, '#2a4056', 1);
  }
}

function drawHeat(canvas, view, building, floorIndex, band, hasBackground) {
  const floor = building.floors[floorIndex];
  const router = building.router;
  let raster = gridCache.get(canvas);
  // Selection and other visual changes can reuse the current matrix.
  const key = [building, building.floorHeight, router, building.bands[band], floor, floor.width, floor.height, hasBackground, ...building.floors.map(f => f.walls)];
  if (!raster || raster.key.some((value, index) => value !== key[index])) {
    const width = Math.max(8, Math.round(48 * floor.width / Math.max(floor.width, floor.height)));
    const height = Math.max(8, Math.round(48 * floor.height / Math.max(floor.width, floor.height)));
    const heat = document.createElement('canvas');
    heat.width = width;
    heat.height = height;
    const ctx = heat.getContext('2d');
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const sample = { x: (col + 0.5) / width * floor.width, y: (row + 0.5) / height * floor.height, floor: floorIndex };
        ctx.fillStyle = color(estimate(router, sample, building, band, false), hasBackground ? 0.57 : 0.90);
        ctx.fillRect(col, row, 1, 1);
      }
    }
    raster = { key, heat };
    gridCache.set(canvas, raster);
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raster.heat, view.left, view.top, view.w, view.h);
  ctx.imageSmoothingEnabled = true;
}

function circle(ctx, x, y, radius, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function label(ctx, x, y, text, maxX) {
  ctx.font = '600 11px system-ui, sans-serif';
  const width = ctx.measureText(text).width + 12;
  const left = x + width <= maxX ? x : Math.max(3, maxX - width);
  ctx.fillStyle = '#142331';
  ctx.fillRect(left, y - 9, width, 19);
  ctx.fillStyle = '#f3fbff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 6, y);
}

export function paintMap(canvas, state) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { building, activeFloor, band, selection, marks, mode, heat, wallStart, draft } = state;
  const floor = building.floors[activeFloor];
  const { background } = floor;
  const view = viewport(width, height, floor);
  const { left, top, w, h } = view;
  const unitX = w / floor.width, unitY = h / floor.height;
  const pos = p => ({ x: left + p.x * unitX, y: top + p.y * unitY });
  const markPos = p => ({ x: left + p.x * w, y: top + p.y * h });
  const ready = !background || background.calibrated;
  const possibleRouter = building.floors[building.router?.floor];
  const wallPaint = '#d0e2ed';
  ctx.fillStyle = background ? '#202b38' : '#192c3f';
  ctx.fillRect(left, top, w, h);
  if (background) {
    const c = background.crop;
    ctx.drawImage(background.image, c.x, c.y, c.width, c.height, left, top, w, h);
  }
  if (ready && heat && building.router && (!possibleRouter.background || possibleRouter.background.calibrated)) {
    drawHeat(canvas, view, building, activeFloor, band, Boolean(background));
  }
  if (!background) paintGrid(ctx, view, unitX, unitY, floor);
  ctx.strokeStyle = '#89aabc';
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, w, h);
  if (ready) {
    ctx.font = '11px monospace';
    ctx.fillStyle = '#b1c5d7';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`${locale.format(floor.width)} m`, left + w / 2, top - 12);
    ctx.textAlign = 'left';
    ctx.fillText(`0,0 · X →  Y ↓`, left, Math.min(height - 8, top + h + 16));
    ctx.save();
    ctx.translate(left - 12, top + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(`${locale.format(floor.height)} m`, 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
    for (const wall of floor.walls) {
      const a = pos(wall.a), b = pos(wall.b);
      const selected = selection?.id === wall.id;
      line(ctx, a, b, selected ? '#ffc797' : wallPaint,
        Math.max(selected ? 4 : 2, Math.min(9, wall.thickness * Math.min(unitX, unitY))));
    }
    if (wallStart) {
      const p = pos(wallStart);
      circle(ctx, p.x, p.y, 5, '#71e4d2', '#0e2930');
    }
    if (draft?.kind === 'wall' && draft.a && draft.b) {
      ctx.setLineDash([5, 4]);
      line(ctx, pos(draft.a), pos(draft.b), '#ffc797', 3);
      ctx.setLineDash([]);
    }
    for (const point of floor.points) {
      const p = pos(point);
      circle(ctx, p.x, p.y, 5, selection?.id === point.id ? '#ffc797' : '#e2eef6', '#132538');
      label(ctx, p.x + 8, p.y, point.name, width - 4);
    }
    if (building.router?.floor === activeFloor) {
      const p = pos(building.router);
      circle(ctx, p.x, p.y, 10, '#143739', '#8bf3e2');
      circle(ctx, p.x, p.y, 3, '#8bf3e2', '#8bf3e2');
      label(ctx, p.x + 13, p.y - 13, 'Router', width - 4);
    }
  }
  if (marks.length && ['calibration', 'crop'].includes(mode)) {
    const a = markPos(marks[0]), b = marks[1] && markPos(marks[1]);
    if (b) line(ctx, a, b, '#ffbe86', 2);
    circle(ctx, a.x, a.y, 5, '#ffbe86', '#20180d');
    if (b) circle(ctx, b.x, b.y, 5, '#ffbe86', '#20180d');
  }
}


