import { estimate, pointInOutline, referenceSignal } from './model.mjs';

const palette = [[36, 53, 91], [57, 115, 174], [117, 173, 201], [229, 200, 117]];
export const DISPLAY_CUTOFF_DBM = -90;
const locale = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
const gridCache = new WeakMap();

export function coverageUpperBound(building, routerFloor, targetFloor, bandKey) {
  const steps = Math.abs(routerFloor - targetFloor);
  const distance = Math.max(1, steps * building.floorHeight);
  const band = building.bands[bandKey];
  return referenceSignal(band) - 10 * band.exponent * Math.log10(distance) - steps * band.slab;
}

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

export function snapWallEnd(start, end, pixelsPerMetreX, pixelsPerMetreY, axes, tolerance = 13) {
  const dx = Math.abs((end.x - start.x) * pixelsPerMetreX);
  const dy = Math.abs((end.y - start.y) * pixelsPerMetreY);
  if (axes.horizontal && dy <= tolerance && dx > tolerance * 1.5) return { x: end.x, y: start.y };
  if (axes.vertical && dx <= tolerance && dy > tolerance * 1.5) return { x: start.x, y: end.y };
  return end;
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
  if (value <= DISPLAY_CUTOFF_DBM) return 'rgba(0,0,0,0)';
  const n = Math.max(0, Math.min(1, (value + 90) / 55)) * (palette.length - 1);
  const k = Math.min(palette.length - 2, Math.floor(n));
  const rgb = palette[k].map((channel, i) => Math.round(channel + (palette[k + 1][i] - channel) * (n - k)));
  return `rgba(${rgb.join(',')},${opacity * Math.min(1, (value - DISPLAY_CUTOFF_DBM) / 9)})`;
}

export function signalColor(value) { return color(value, 1); }

// Planos importados (PNG o DWG) traen su propio fondo oscuro: sobre ellos se usa siempre esta paleta.
const ON_IMAGE = {
  sheet: '#202b38', wall: '#d0e2ed', point: '#e2eef6', pointLine: '#132538',
  labelBg: '#142331', labelFg: '#f3fbff', labelLine: '#35506a', select: '#ffc797',
  routerFill: '#172a47', routerLine: '#8ab5ff', start: '#8ab5ff', grid: '#2a4056'
};

// Lee los colores del tema activo desde las variables CSS (--cv-*) definidas en styles.css.
function theme(canvas, onImage) {
  const css = getComputedStyle(canvas);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const own = {
    sheet: v('--cv-sheet', '#17212c'), grid: v('--cv-grid', '#243241'), wall: v('--cv-wall', '#cfe0ee'),
    point: v('--cv-point', '#e6f0f8'), pointLine: v('--cv-point-line', '#0c1117'),
    labelBg: v('--cv-label-bg', '#0e141b'), labelFg: v('--cv-label-fg', '#f1f6fb'), labelLine: v('--cv-label-line', '#38485c'),
    select: v('--cv-select', '#ffb25e'), routerFill: v('--cv-router-fill', '#172a47'),
    routerLine: v('--cv-router-line', '#8ab5ff'), start: v('--cv-start', '#8ab5ff')
  };
  return { ...(onImage ? ON_IMAGE : own), axis: v('--cv-axis', '#94a3b5'), frame: v('--cv-frame', '#5d7288') };
}

function line(ctx, a, b, paint, width) {
  ctx.strokeStyle = paint;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function paintGrid(ctx, view, dividedX, dividedY, floor, paint) {
  const { left, top, w, h } = view;
  const step = Math.max(1, Math.ceil(Math.max(floor.width, floor.height) / 20));
  for (let x = step; x < floor.width; x += step) {
    const pos = left + x * dividedX;
    line(ctx, {x: pos, y: top}, {x: pos, y: top + h}, paint, 1);
  }
  for (let y = step; y < floor.height; y += step) {
    const pos = top + y * dividedY;
    line(ctx, {x: left, y: pos}, {x: left + w, y: pos}, paint, 1);
  }
}

function drawHeat(canvas, view, building, floorIndex, band, hasBackground) {
  const floor = building.floors[floorIndex];
  const router = building.router;
  let raster = gridCache.get(canvas);
  // Selection and other visual changes can reuse the current matrix.
  const key = [building, building.floorHeight, router, building.bands[band], floor, floor.width, floor.height,
    hasBackground, ...building.floors.slice(0, building.count).flatMap(item => [item.walls, item.outline])];
  if (!raster || raster.key.length !== key.length || raster.key.some((value, index) => value !== key[index])) {
    const detail = Math.max(12, Math.round(48 / Math.sqrt(1 + Math.abs(router.floor - floorIndex) / 2)));
    const width = Math.max(8, Math.round(detail * floor.width / Math.max(floor.width, floor.height)));
    const height = Math.max(8, Math.round(detail * floor.height / Math.max(floor.width, floor.height)));
    const heat = document.createElement('canvas');
    heat.width = width;
    heat.height = height;
    const ctx = heat.getContext('2d');
    const upperBound = coverageUpperBound(building, router.floor, floorIndex, band);
    let maxSignal = upperBound;
    if (upperBound > DISPLAY_CUTOFF_DBM) {
      maxSignal = -Infinity;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const sample = { x: (col + 0.5) / width * floor.width, y: (row + 0.5) / height * floor.height, floor: floorIndex };
          if (!pointInOutline(sample, floor.outline)) continue;
          const signal = estimate(router, sample, building, band, false);
          maxSignal = Math.max(maxSignal, signal);
          ctx.fillStyle = color(signal, hasBackground ? 0.57 : 0.90);
          ctx.fillRect(col, row, 1, 1);
        }
      }
    }
    raster = { key, heat, maxSignal };
    gridCache.set(canvas, raster);
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raster.heat, view.left, view.top, view.w, view.h);
  ctx.imageSmoothingEnabled = true;
  return raster.maxSignal;
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

function label(ctx, x, y, text, maxX, t) {
  ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
  const width = ctx.measureText(text).width + 14;
  const left = x + width <= maxX ? x : Math.max(3, maxX - width);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, y - 10, width, 20, 5); else ctx.rect(left, y - 10, width, 20);
  ctx.fillStyle = t.labelBg;
  ctx.fill();
  ctx.strokeStyle = t.labelLine;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = t.labelFg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, left + 7, y + .5);
}

function outlinePath(ctx, vertices, pos) {
  if (!vertices?.length) return;
  ctx.beginPath();
  const first = pos(vertices[0]);
  ctx.moveTo(first.x, first.y);
  for (const vertex of vertices.slice(1)) {
    const point = pos(vertex);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

export function paintMap(canvas, state) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { building, activeFloor, band, selection, marks, mode, heat, wallStart, wallPreview,
    outlineDraft, outlineHover, draft } = state;
  const floor = building.floors[activeFloor];
  const { background } = floor;
  const view = viewport(width, height, floor);
  const { left, top, w, h } = view;
  const unitX = w / floor.width, unitY = h / floor.height;
  const pos = p => ({ x: left + p.x * unitX, y: top + p.y * unitY });
  const markPos = p => ({ x: left + p.x * w, y: top + p.y * h });
  const ready = !background || background.calibrated;
  const possibleRouter = building.floors[building.router?.floor];
  const t = theme(canvas, Boolean(background));
  ctx.fillStyle = t.sheet;
  ctx.fillRect(left, top, w, h);
  ctx.save();
  if (floor.outline) {
    outlinePath(ctx, floor.outline.vertices, pos);
    ctx.clip();
  }
  if (background) {
    const c = background.crop;
    ctx.drawImage(background.image, c.x, c.y, c.width, c.height, left, top, w, h);
  }
  const firstFloor = Math.min(building.router?.floor ?? activeFloor, activeFloor);
  const lastFloor = Math.max(building.router?.floor ?? activeFloor, activeFloor);
  const pathReady = building.floors.slice(firstFloor, lastFloor + 1).every(item => !item.background || item.background.calibrated);
  const coverage = ready && heat && building.router && pathReady &&
    (!possibleRouter.background || possibleRouter.background.calibrated)
    ? drawHeat(canvas, view, building, activeFloor, band, Boolean(background)) : null;
  if (!background) {
    ctx.globalAlpha = coverage === null ? 1 : .4;
    paintGrid(ctx, view, unitX, unitY, floor, t.grid);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.strokeStyle = t.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + .5, top + .5, w - 1, h - 1);
  if (floor.outline) {
    outlinePath(ctx, floor.outline.vertices, pos);
    ctx.strokeStyle = t.select;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (ready) {
    ctx.font = '500 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = t.axis;
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
      line(ctx, a, b, selected ? t.select : t.wall,
        Math.max(selected ? 4 : 2, Math.min(9, wall.thickness * Math.min(unitX, unitY))));
    }
    if (wallStart) {
      const p = pos(wallStart);
      circle(ctx, p.x, p.y, 5, t.start, t.pointLine);
    }
    if (wallPreview) {
      const a = pos(wallPreview.a), b = pos(wallPreview.b);
      ctx.setLineDash([8, 5]);
      line(ctx, a, b, t.select, 4);
      ctx.setLineDash([]);
      circle(ctx, a.x, a.y, 5, t.select, t.pointLine);
      circle(ctx, b.x, b.y, 5, t.select, t.pointLine);
    }
    if (draft?.kind === 'wall' && draft.a && draft.b) {
      ctx.setLineDash([5, 4]);
      line(ctx, pos(draft.a), pos(draft.b), t.select, 3);
      ctx.setLineDash([]);
    }
    for (const point of floor.points) {
      const p = pos(point);
      circle(ctx, p.x, p.y, selection?.id === point.id ? 6 : 5, selection?.id === point.id ? t.select : t.point, t.pointLine);
      label(ctx, p.x + 9, p.y, point.name, width - 4, t);
    }
    if (building.router?.floor === activeFloor) {
      const p = pos(building.router);
      ctx.globalAlpha = .2;
      circle(ctx, p.x, p.y, 17, t.routerLine, t.routerLine);
      ctx.globalAlpha = 1;
      circle(ctx, p.x, p.y, 10, t.routerFill, t.routerLine);
      circle(ctx, p.x, p.y, 3, t.routerLine, t.routerLine);
      label(ctx, p.x + 15, p.y - 15, 'Router', width - 4, t);
    }
  }
  if (marks.length && ['calibration', 'crop'].includes(mode)) {
    const a = markPos(marks[0]), b = marks[1] && markPos(marks[1]);
    if (b) line(ctx, a, b, t.select, 2);
    circle(ctx, a.x, a.y, 5, t.select, t.pointLine);
    if (b) circle(ctx, b.x, b.y, 5, t.select, t.pointLine);
  }
  if (mode === 'outline' && outlineDraft?.length) {
    const vertices = outlineHover ? [...outlineDraft, outlineHover] : outlineDraft;
    ctx.beginPath();
    vertices.forEach((vertex, index) => {
      const p = pos(vertex);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = '#9fc1ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    outlineDraft.forEach((vertex, index) => {
      const p = pos(vertex);
      circle(ctx, p.x, p.y, index === 0 ? 7 : 5, index === 0 ? '#e9c875' : '#9fc1ff', '#10223c');
    });
  }
  return coverage;
}


