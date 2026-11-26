export const BANDS = {
  '2.4': { label: '2,4 GHz', frequency: 2.4e9, eirp: 20, gain: 0, exponent: 2, slab: 12 },
  '5': { label: '5 GHz', frequency: 5e9, eirp: 20, gain: 0, exponent: 2, slab: 18 }
};
export const MATERIALS = {
  madera: { label: 'Madera', losses: { '2.4': 2, '5': 3 } },
  tabique: { label: 'Tabique liviano', losses: { '2.4': 3, '5': 5 } },
  ladrillo: { label: 'Ladrillo', losses: { '2.4': 6, '5': 9 } },
  hormigon: { label: 'Hormigón', losses: { '2.4': 10, '5': 15 } },
  otro: { label: 'Otro', losses: { '2.4': 4, '5': 6 } }
};
export const REFERENCE_DISTANCE = 1;
export const REFERENCE_THICKNESS = 0.1;
const C = 299792458;
export const EPSILON = 1e-8;

export function distance(a, b, floorHeight) {
  return Math.hypot(b.x - a.x, b.y - a.y, (b.floor - a.floor) * floorHeight);
}

export function angle(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx === 0 && dy === 0 ? null : Math.atan2(dy, dx) * 180 / Math.PI;
}

export function freeSpaceLoss(frequency) {
  return 20 * Math.log10(4 * Math.PI * frequency * REFERENCE_DISTANCE / C);
}

export function referenceSignal(band) {
  return band.eirp + band.gain - freeSpaceLoss(band.frequency);
}

export function wallLoss(wall, band) {
  return wall.losses[band] * (wall.thickness / REFERENCE_THICKNESS);
}

export function segmentCrossing(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const lengthProduct = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  const determinant = rx * sy - ry * sx;
  if (lengthProduct === 0 || Math.abs(determinant) <= EPSILON * lengthProduct) return null;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / determinant;
  const u = (qx * ry - qy * rx) / determinant;
  // Count only transverse crossings through the interior of both segments.
  return t > EPSILON && t < 1 - EPSILON && u > EPSILON && u < 1 - EPSILON ? t : null;
}

export function sameWall(first, second) {
  const samePoint = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < EPSILON;
  return (samePoint(first.a, second.a) && samePoint(first.b, second.b)) ||
         (samePoint(first.a, second.b) && samePoint(first.b, second.a));
}

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (p, a, b) => Math.abs(cross(a, b, p)) < EPSILON &&
  p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
  p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;

export function pointInOutline(point, outline) {
  if (!outline?.vertices?.length) return true;
  const vertices = outline.vertices;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[j], b = vertices[i];
    if (onSegment(point, a, b)) return true;
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function edgeParameters(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  const lengthSquared = r.x * r.x + r.y * r.y;
  if (Math.abs(denominator) < EPSILON) {
    if (Math.abs(cross(a, b, c)) >= EPSILON || !lengthSquared) return [];
    const projections = [c, d].map(p => ((p.x - a.x) * r.x + (p.y - a.y) * r.y) / lengthSquared);
    if (Math.max(...projections) < -EPSILON || Math.min(...projections) > 1 + EPSILON) return [];
    return [Math.max(0, Math.min(...projections)), Math.min(1, Math.max(...projections))];
  }
  const offset = { x: c.x - a.x, y: c.y - a.y };
  const t = (offset.x * s.y - offset.y * s.x) / denominator;
  const u = (offset.x * r.y - offset.y * r.x) / denominator;
  return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON ? [t] : [];
}

export function segmentInOutline(a, b, outline) {
  if (!outline?.vertices?.length) return true;
  if (!pointInOutline(a, outline) || !pointInOutline(b, outline)) return false;
  const vertices = outline.vertices;
  const cuts = [0, 1];
  for (let i = 0; i < vertices.length; i++) {
    cuts.push(...edgeParameters(a, b, vertices[i], vertices[(i + 1) % vertices.length]));
  }
  cuts.sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    const t = (cuts[i - 1] + cuts[i]) / 2;
    if (!pointInOutline({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, outline)) return false;
  }
  return true;
}

export function validOutline(vertices) {
  if (vertices.length < 3 || vertices.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const count = vertices.length;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const a = vertices[i], b = vertices[(i + 1) % count];
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPSILON) return false;
    const c = vertices[(i + 2) % count];
    if (Math.abs(cross(a, b, c)) < EPSILON &&
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) return false;
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area) < EPSILON) return false;
  for (let i = 0; i < count; i++) {
    const a = vertices[i], b = vertices[(i + 1) % count];
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const c = vertices[j], d = vertices[(j + 1) % count];
      if (edgeParameters(a, b, c, d).length) return false;
    }
  }
  return true;
}

function outlineWalls(outline) {
  if (!outline?.vertices?.length) return [];
  return outline.vertices.map((a, index) => ({
    id: `exterior-${index}`, a, b: outline.vertices[(index + 1) % outline.vertices.length],
    material: outline.material, thickness: outline.thickness, losses: outline.losses
  }));
}

export function estimate(router, point, context, bandKey, details = true) {
  const band = context.bands[bandKey];
  const d = distance(router, point, context.floorHeight);
  const floorSteps = Math.abs(point.floor - router.floor);
  const differentFloor = floorSteps > 0;
  const slab = floorSteps * band.slab;
  const distanceLoss = 10 * band.exponent * Math.log10(Math.max(d, REFERENCE_DISTANCE) / REFERENCE_DISTANCE);
  const reference = referenceSignal(band);
  let wallsLoss = 0;
  const walls = [];
  const considerFloor = (floor, start, end) => {
    const counted = new Set();
    for (const wall of [...context.floors[floor].walls, ...outlineWalls(context.floors[floor].outline)]) {
      if (counted.has(wall.id)) continue;
      const t = segmentCrossing(router, point, wall.a, wall.b);
      if (t === null || t <= start + EPSILON || t >= end - EPSILON) continue;
      counted.add(wall.id);
      const loss = wallLoss(wall, bandKey);
      wallsLoss += loss;
      if (details) walls.push({ id: wall.id, floor, material: wall.material, loss });
    }
  };
  const direction = Math.sign(point.floor - router.floor);
  for (let step = 0; step <= floorSteps; step++) {
    const start = step === 0 ? 0 : (step - 0.5) / floorSteps;
    const end = step === floorSteps ? 1 : (step + 0.5) / floorSteps;
    considerFloor(router.floor + direction * step, start, end);
  }
  const signal = reference - distanceLoss - wallsLoss - slab;
  if (!details) return signal;
  return { d, angle: angle(router, point), reference, fspl: freeSpaceLoss(band.frequency),
    distanceLoss, wallsLoss, slab, differentFloor, walls, signal };
}

export function comparePositions(positions, points, context, bandKey) {
  return positions.map(position => {
    const values = points.map(point => estimate(position, point, context, bandKey, false));
    let worstIndex = -1;
    for (const [index, value] of values.entries()) {
      if (worstIndex < 0 || value < values[worstIndex]) worstIndex = index;
    }
    return { position, values, worstIndex, minimum: values[worstIndex] ?? null };
  }).sort((a, b) => (b.minimum ?? 0) - (a.minimum ?? 0));
}

export function calibratedDimensions(widthPx, heightPx, a, b, metres) {
  const pixels = Math.hypot((a.x - b.x) * widthPx, (a.y - b.y) * heightPx);
  if (![widthPx, heightPx, metres, pixels].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error('Marca dos puntos distintos e ingresa una distancia mayor que cero.');
  }
  const metresPerPixel = metres / pixels;
  const width = widthPx * metresPerPixel;
  const height = heightPx * metresPerPixel;
  if (![width, height, metresPerPixel].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error('La escala calculada está fuera del rango numérico.');
  }
  return { width, height, metresPerPixel };
}

