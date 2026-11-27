import { BANDS, MATERIALS, validOutline, pointInOutline, segmentInOutline } from './model.mjs';

export const PROJECT_FORMAT = 'routeroptimal-smart';
export const PROJECT_VERSION = 1;
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const id = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const text = value => typeof value === 'string' && value.length <= 120;
const point = (value, floor) => value && finite(value.x, 0, floor.width) && finite(value.y, 0, floor.height);
const losses = value => value && ['2.4', '5'].every(band => finite(value[band], 0, 1000));

export function validateProject(project) {
  if (project?.format !== PROJECT_FORMAT || project.version !== PROJECT_VERSION) throw new Error('El archivo no es un modelo Router Smart compatible.');
  const { building } = project;
  if (!building || !Number.isInteger(building.count) || building.count < 1 || building.count > 50 ||
      !Array.isArray(building.floors) || building.floors.length !== building.count ||
      !finite(building.floorHeight, .01, 10000) || !building.bands) throw new Error('La estructura de pisos del modelo no es válida.');
  for (const key of Object.keys(BANDS)) {
    const band = building.bands[key];
    if (!band || !['frequency', 'eirp', 'gain', 'exponent', 'slab'].every(name => finite(band[name], -1000, 1e11)) ||
        band.frequency !== BANDS[key].frequency || band.exponent <= 0 || band.slab < 0) {
      throw new Error('Los parámetros de señal del modelo no son válidos.');
    }
  }
  for (const floor of building.floors) {
    if (!floor || !finite(floor.width, .01, 10000) || !finite(floor.height, .01, 10000) ||
        !['draw', 'import'].includes(floor.route) || !Array.isArray(floor.walls) || floor.walls.length > 5000 ||
        !Array.isArray(floor.points) || floor.points.length > 5000) throw new Error('Un piso del modelo no es válido.');
    if (floor.background && (!text(floor.background.name) || typeof floor.background.src !== 'string' ||
        !/^(\.\/assets\/(planta-baja|planta-alta)\.png|data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+)$/i.test(floor.background.src) ||
        typeof floor.background.calibrated !== 'boolean' || !floor.background.crop ||
        !['x', 'y', 'width', 'height'].every(key => finite(floor.background.crop[key], key === 'width' || key === 'height' ? 1 : 0, 100000)))) {
      throw new Error('La imagen guardada en el modelo no es válida.');
    }
    const outline = floor.outline;
    if (outline && (!Array.isArray(outline.vertices) || outline.vertices.length > 1000 ||
        !outline.vertices.every(vertex => point(vertex, floor)) || !validOutline(outline.vertices) ||
        !MATERIALS[outline.material] || !finite(outline.thickness, .0001, 100) || !losses(outline.losses))) {
      throw new Error('El contorno del modelo no es válido.');
    }
    for (const wall of floor.walls) {
      if (!wall || !id(wall.id) || !MATERIALS[wall.material] || !finite(wall.thickness, .0001, 100) ||
          !losses(wall.losses) || !point(wall.a, floor) || !point(wall.b, floor) ||
          !segmentInOutline(wall.a, wall.b, outline)) throw new Error('Un muro del modelo no es válido.');
    }
    for (const p of floor.points) {
      if (!p || !id(p.id) || !text(p.name) || !point(p, floor) || !pointInOutline(p, outline)) throw new Error('Un punto del modelo no es válido.');
    }
  }
  if (!Array.isArray(building.positions) || building.positions.length > 5000) throw new Error('Las posiciones guardadas no son válidas.');
  const located = p => p && Number.isInteger(p.floor) && p.floor >= 0 && p.floor < building.count &&
    point(p, building.floors[p.floor]) && pointInOutline(p, building.floors[p.floor].outline);
  for (const [index, floor] of building.floors.entries()) {
    if (floor.points.some(p => p.floor !== index)) throw new Error('Un punto pertenece a otro piso.');
  }
  if (building.router && !located(building.router)) throw new Error('La posición del router no es válida.');
  if (building.positions.some(p => !located(p) || !id(p.id) || !text(p.name))) throw new Error('Una posición guardada no es válida.');
  if (!Number.isInteger(project.activeFloor) || project.activeFloor < 0 || project.activeFloor >= building.count ||
      !Object.hasOwn(BANDS, project.band) || typeof project.heat !== 'boolean') throw new Error('La vista guardada no es válida.');
  return project;
}
