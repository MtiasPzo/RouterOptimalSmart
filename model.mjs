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

export function estimate(router, point, context, bandKey, details = true) {
  const band = context.bands[bandKey];
  const d = distance(router, point, context.floorHeight);
  const differentFloor = router.floor !== point.floor;
  const slab = differentFloor ? band.slab : 0;
  const distanceLoss = 10 * band.exponent * Math.log10(Math.max(d, REFERENCE_DISTANCE) / REFERENCE_DISTANCE);
  const reference = referenceSignal(band);
  let wallsLoss = 0;
  const walls = [];
  const considerFloor = (floor, firstHalf) => {
    const counted = new Set();
    for (const wall of context.floors[floor].walls) {
      if (counted.has(wall.id)) continue;
      const t = segmentCrossing(router, point, wall.a, wall.b);
      if (t === null || (differentFloor && (firstHalf ? t >= 0.5 - EPSILON : t <= 0.5 + EPSILON))) continue;
      counted.add(wall.id);
      const loss = wallLoss(wall, bandKey);
      wallsLoss += loss;
      if (details) walls.push({ id: wall.id, floor, material: wall.material, loss });
    }
  };
  considerFloor(router.floor, true);
  if (differentFloor) considerFloor(point.floor, false);
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

