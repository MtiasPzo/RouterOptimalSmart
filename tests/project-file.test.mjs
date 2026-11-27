import test from 'node:test';
import assert from 'node:assert/strict';
import { example } from '../examples.mjs';
import { PROJECT_FORMAT, PROJECT_VERSION, validateProject } from '../project-file.mjs';

const project = building => ({ format: PROJECT_FORMAT, version: PROJECT_VERSION,
  building, activeFloor: 0, band: '2.4', heat: true });

test('acepta un modelo completo y conserva muros, pisos y parámetros', () => {
  const original = project(example('two'));
  const restored = validateProject(JSON.parse(JSON.stringify(original)));
  assert.equal(restored.building.count, 2);
  assert.equal(restored.building.floors[0].walls.length, 5);
  assert.deepEqual(restored.building.bands, original.building.bands);
});

test('rechaza archivos ajenos y geometría inválida sin alterar el modelo actual', () => {
  assert.throws(() => validateProject({ format: 'otro', version: 1 }), /compatible/);
  const bad = project(example('one'));
  bad.building.floors[0].walls[0].a.x = -1;
  assert.throws(() => validateProject(bad), /muro/);
});

test('acepta las imágenes integradas y rechaza fuentes externas', () => {
  const saved = project(example('cad'));
  saved.building.floors[0].background = {
    name: 'planta-baja.png', note: 'Ejemplo', calibrated: false,
    crop: { x: 0, y: 0, width: 544, height: 962 }, src: './assets/planta-baja.png'
  };
  validateProject(saved);
  saved.building.floors[0].background.src = 'https://example.com/otro.png';
  assert.throws(() => validateProject(saved), /imagen/);
});
