import { BANDS, MATERIALS } from './model.mjs';

export const newFloor = () => ({ width: 9, height: 14, route: 'draw', background: null, outline: null, walls: [], points: [] });
export function removeFloor(building, index) {
  if (building.count <= 1 || !Number.isInteger(index) || index < 0 || index >= building.count) {
    throw new Error('Debe quedar al menos un piso en la vivienda.');
  }
  const shift = floor => floor > index ? floor - 1 : floor;
  const floors = building.floors.filter((_, floor) => floor !== index)
    .map((item, floor) => ({ ...item, points: item.points.map(point => ({ ...point, floor })) }));
  const router = building.router?.floor === index ? null :
    building.router ? { ...building.router, floor: shift(building.router.floor) } : null;
  const positions = building.positions.filter(position => position.floor !== index)
    .map(position => ({ ...position, floor: shift(position.floor) }));
  return { ...building, floors, count: building.count - 1, router, positions };
}
const segment = (id, material, thickness, x1, y1, x2, y2) => ({
  id, material, thickness, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, losses: { ...MATERIALS[material].losses }
});
const point = (id, name, x, y, floor) => ({ id, name, x, y, floor });

export function example(key) {
  const floors = [newFloor()];
  if (key === 'two' || key === 'cad') floors.push(newFloor());
  if (key === 'one' || key === 'two') {
    floors[0].walls = [
      segment('w1', 'ladrillo', 0.15, 4, 0, 4, 7),
      segment('w2', 'tabique', 0.10, 0, 6, 3.2, 6),
      segment('w3', 'ladrillo', 0.15, 4, 7, 9, 7),
      segment('w4', 'madera', 0.10, 5.3, 9.4, 5.3, 14),
      segment('w5', 'tabique', 0.10, 0, 10.5, 4.2, 10.5)
    ];
    floors[0].points = [point('p1', 'Escritorio', 2, 2.2, 0), point('p2', 'Sala', 7.3, 4.4, 0),
      point('p3', 'Comedor', 2.1, 12.3, 0)];
    if (key === 'two') {
      floors[1].walls = [
        segment('w6', 'hormigon', 0.16, 4.8, 0, 4.8, 6.5),
        segment('w7', 'tabique', 0.10, 0, 6.5, 3.7, 6.5),
        segment('w8', 'ladrillo', 0.15, 4.8, 7.5, 9, 7.5),
        segment('w9', 'tabique', 0.10, 5.4, 10.2, 5.4, 14)
      ];
      floors[1].points = [point('p4', 'Dormitorio norte', 6.9, 2.4, 1), point('p5', 'Sala de estudio', 2.6, 11.4, 1)];
    }
  }
  return {
    floors, count: key === 'two' || key === 'cad' ? 2 : 1, floorHeight: 2.7,
    bands: structuredClone(BANDS), router: null, positions: []
  };
}
