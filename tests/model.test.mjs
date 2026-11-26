import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, distance, angle, freeSpaceLoss, referenceSignal, segmentCrossing, estimate,
  comparePositions, calibratedDimensions, pointInOutline, segmentInOutline, validOutline } from '../model.mjs';
import { snapWallEnd, coverageUpperBound, DISPLAY_CUTOFF_DBM } from '../map.mjs';
import { example, newFloor, removeFloor } from '../examples.mjs';

const p = (x, y, floor = 0) => ({ x, y, floor });
const wall = (id, x, thickness = 0.1) => ({
  id, material: 'ladrillo', thickness, losses: { '2.4': 6, '5': 9 }, a: p(x, 0), b: p(x, 4)
});
const context = (a = [], b = []) => ({ floorHeight: 12, bands: BANDS, floors: [{ walls: a }, { walls: b }] });
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test('el ajuste de muros corrige trazos cercanos al eje y respeta diagonales intencionales', () => {
  const start = { x: 2, y: 2 };
  const axes = { horizontal: true, vertical: true };
  assert.deepEqual(snapWallEnd(start, { x: 7, y: 2.12 }, 40, 40, axes), { x: 7, y: 2 });
  assert.deepEqual(snapWallEnd(start, { x: 2.1, y: 6 }, 40, 40, axes), { x: 2, y: 6 });
  assert.deepEqual(snapWallEnd(start, { x: 7, y: 5 }, 40, 40, axes), { x: 7, y: 5 });
  assert.deepEqual(snapWallEnd(start, { x: 7, y: 2.12 }, 40, 40, { horizontal: false, vertical: true }), { x: 7, y: 2.12 });
});

test('el contorno acepta una vivienda cóncava y excluye su hueco exterior', () => {
  const vertices = [p(0, 0), p(6, 0), p(6, 6), p(4, 6), p(4, 2), p(2, 2), p(2, 6), p(0, 6)];
  const outline = { vertices, material: 'ladrillo', thickness: 0.1, losses: { '2.4': 6, '5': 9 } };
  assert.equal(validOutline(vertices), true);
  assert.equal(validOutline([p(0, 0), p(4, 4), p(0, 4), p(4, 0)]), false);
  assert.equal(validOutline([p(0, 0), p(4, 0), p(2, 0), p(4, 4), p(0, 4)]), false);
  assert.equal(pointInOutline(p(3, 5), outline), false);
  assert.equal(pointInOutline(p(1, 5), outline), true);
  assert.equal(pointInOutline(p(2, 3), outline), true);
  assert.equal(segmentInOutline(p(1, 5), p(5, 5), outline), false);
  assert.equal(segmentInOutline(p(1, 1), p(5, 1), outline), true);
  const building = context();
  building.floors[0].outline = outline;
  const result = estimate(p(1, 5), p(5, 5), building, '2.4');
  close(result.wallsLoss, 12);
});

test('distancia euclidiana 2D, 3D, simétrica y ángulo descriptivo', () => {
  assert.equal(distance(p(0, 0), p(3, 4), 12), 5);
  assert.equal(distance(p(0, 0), p(3, 4, 1), 12), 13);
  assert.equal(distance(p(3, 4, 1), p(0, 0), 12), 13);
  assert.equal(angle(p(1, 1), p(1, 5)), 90);
  assert.equal(angle(p(1, 1), p(1, 1, 1)), null);
});

test('FSPL a 1 m por banda, referencia editable y pendiente sin duplicar frecuencia', () => {
  const b24 = BANDS['2.4'], b5 = BANDS['5'];
  close(freeSpaceLoss(b24.frequency), 40.052, 0.001);
  close(freeSpaceLoss(b5.frequency), 46.427, 0.001);
  close(referenceSignal({ ...b5, eirp: 10, gain: 3 }), 13 - freeSpaceLoss(b5.frequency));
  const ctx = context();
  close(estimate(p(0, 0), p(0, 0), ctx, '2.4').signal, referenceSignal(b24));
  close(estimate(p(0, 0), p(0.5, 0), ctx, '5').signal, referenceSignal(b5));
  const a = estimate(p(0, 0), p(10, 0), ctx, '2.4');
  const b = estimate(p(0, 0), p(10, 0), ctx, '5');
  close(a.distanceLoss, 20);
  close(a.signal - b.signal, 20 * Math.log10(5 / 2.4));
  ctx.bands = { ...BANDS, '2.4': { ...b24, exponent: 3 } };
  close(estimate(p(0, 0), p(10, 0), ctx, '2.4').distanceLoss, 30);
});

test('cruce transversal, tangencia, colinealidad y límites del segmento', () => {
  const a = p(0, 2), b = p(10, 2);
  close(segmentCrossing(a, b, p(3, 0), p(3, 4)), 0.3);
  assert.equal(segmentCrossing(a, b, p(3, 2), p(3, 4)), null);
  assert.equal(segmentCrossing(a, b, p(3, 2), p(5, 2)), null);
  assert.equal(segmentCrossing(a, b, p(13, 0), p(13, 4)), null);
  assert.equal(segmentCrossing(a, b, a, p(0, 4)), null);
});

test('pérdida de muro por grosor y banda, sin repetir la misma identidad', () => {
  const thick = wall('a', 4, 0.15);
  const ctx = context([thick, thick]);
  const result = estimate(p(0, 2), p(10, 2), ctx, '2.4');
  assert.equal(result.walls.length, 1);
  close(result.wallsLoss, 9);
  close(estimate(p(0, 2), p(10, 2), ctx, '5').wallsLoss, 13.5);
  assert.equal(result.slab, 0);
});

test('cambio de piso: se cuenta una losa y los muros de cada tramo', () => {
  const ctx = context([wall('a', 2), wall('b', 8)], [wall('c', 2), wall('d', 8)]);
  for (const [band, slab, wallsLoss] of [['2.4', 12, 12], ['5', 18, 18]]) {
    const result = estimate(p(0, 2), p(10, 2, 1), ctx, band);
    close(result.d, Math.sqrt(244));
    assert.deepEqual(result.walls.map(w => w.id), ['a', 'd']);
    assert.equal(result.slab, slab);
    assert.equal(result.wallsLoss, wallsLoss);
    close(estimate(p(10, 2, 1), p(0, 2), ctx, band).signal, result.signal);
    close(result.signal, result.reference - result.distanceLoss - wallsLoss - slab);
  }
  const vertical = estimate(p(2, 2), p(2, 2, 1), ctx, '5');
  assert.equal(vertical.walls.length, 0);
  assert.equal(vertical.slab, 18);
});

test('varios pisos acumulan cada losa y los muros intermedios, con proyección que se atenúa', () => {
  const floors = [1, 4, 8, 11].map((x, index) => ({ walls: [wall(`f${index}`, x)] }));
  const building = { floorHeight: 3, bands: BANDS, floors };
  const result = estimate(p(0, 2, 0), p(12, 2, 3), building, '2.4');
  close(result.d, 15);
  close(result.slab, 36);
  close(result.wallsLoss, 24);
  assert.deepEqual(result.walls.map(item => item.floor), [0, 1, 2, 3]);
  close(estimate(p(12, 2, 3), p(0, 2, 0), building, '2.4').signal, result.signal);
  const projection = { floorHeight: 2.7, bands: BANDS };
  assert.ok(coverageUpperBound(projection, 0, 4, '2.4') > DISPLAY_CUTOFF_DBM);
  assert.ok(coverageUpperBound(projection, 0, 5, '2.4') < DISPLAY_CUTOFF_DBM);
  assert.ok(coverageUpperBound(projection, 0, 5, '2.4') < coverageUpperBound(projection, 0, 4, '2.4'));
});

test('eliminar un piso renumera los superiores y conserva sus elementos y posiciones', () => {
  const base = example('two');
  const third = newFloor();
  third.points = [{ id: 'alto', name: 'Terraza', x: 2, y: 3, floor: 2 }];
  const building = { ...base, count: 3, floors: [...base.floors, third],
    router: { x: 1, y: 2, floor: 2 },
    positions: [{ id: 'sale', x: 2, y: 2, floor: 1 }, { id: 'stays', x: 1, y: 2, floor: 2 }] };
  const result = removeFloor(building, 1);
  assert.equal(result.count, 2);
  assert.equal(result.floors.length, 2);
  assert.equal(result.floors[1].points[0].floor, 1);
  assert.equal(result.router.floor, 1);
  assert.deepEqual(result.positions.map(position => [position.id, position.floor]), [['stays', 1]]);
  assert.equal(building.router.floor, 2);
  assert.equal(removeFloor(building, 2).router, null);
  assert.throws(() => removeFloor(result, 2), /al menos un piso/);
  assert.throws(() => removeFloor(example('one'), 0), /al menos un piso/);
});

test('la comparación maximiza el mínimo y conserva todos los resultados', () => {
  const left = { id: 'a', ...p(0, 0) }, centre = { id: 'b', ...p(5, 0) };
  const targets = [p(0, 0), p(10, 0)];
  const rows = comparePositions([left, centre], targets, context(), '2.4');
  assert.equal(rows[0].position.id, 'b');
  assert.equal(rows[0].values.length, 2);
  assert.equal(rows[1].worstIndex, 1);
  assert.ok(rows[1].values[0] > rows[0].values[0]);
  assert.ok(rows[0].minimum > rows[1].minimum);
  assert.equal(comparePositions([left], [], context(), '5')[0].minimum, null);
});

test('escala proporcional a partir de píxeles y rechazo de escalas inválidas', () => {
  const dims = calibratedDimensions(800, 600, p(0, 0), p(0.5, 0), 8);
  assert.deepEqual(dims, { width: 16, height: 12, metresPerPixel: 0.02 });
  assert.throws(() => calibratedDimensions(800, 600, p(0, 0), p(0, 0), 8), /distintos/);
  assert.throws(() => calibratedDimensions(800, 600, p(0, 0), p(1, 0), 0), /mayor que cero/);
});
