import { BANDS, MATERIALS, EPSILON, estimate, comparePositions, calibratedDimensions, sameWall,
  pointInOutline, segmentInOutline, validOutline } from './model.mjs';
import { newFloor, example, removeFloor } from './examples.mjs';
import { canvasPoint, hitTest, paintMap, signalColor, snapWallEnd, viewport, DISPLAY_CUTOFF_DBM } from './map.mjs';
import { setupFieldHelp } from './field-help.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  building: example('one'), activeFloor: 0, band: '2.4', heat: true,
  mode: 'router', marks: [], selection: null, draft: null, wallStart: null, wallPreview: null,
  outlineDraft: [], outlineHover: null
};
const canvas = $('#plan');
const quickWallForm = $('#quick-wall-form');
const quickWallField = name => quickWallForm.elements.namedItem(name);
const quickDefaults = { material: 'tabique', thickness: 10 };
const forms = Object.fromEntries(['building', 'dimensions', 'band', 'calibration', 'element', 'save']
  .map(key => [key, $(`#${key}-form`)]));
const field = (form, name) => forms[form].elements.namedItem(name);
const floor = () => state.building.floors[state.activeFloor];
const ensureFloors = count => { while (state.building.floors.length < count) state.building.floors.push(newFloor()); };
const ready = item => !item.background || item.background.calibrated;
const pathReady = (building, from, to) => building.floors.slice(Math.min(from, to), Math.max(from, to) + 1).every(ready);
const points = () => state.building.floors.slice(0, state.building.count).flatMap(item => item.points);
const placements = () => state.building.positions.filter(position => position.floor < state.building.count);
const numberFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
const f = value => numberFormat.format(value);
const esc = str => String(str).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const floorName = index => `Piso ${index + 1}`;
// Punto de color con la misma escala que el mapa y su leyenda (−90 a −35 dBm).
const dot = value => `<i class="sig" style="background:${signalColor(value)}"></i>`;
const targetMarks = new WeakMap();
let nextId = 0;
let noticeTimer;
let exampleRequest = 0;
let wallGesture = null;
let suppressWallClick = false;

function announce(message, error = false) {
  const el = $('#feedback');
  el.hidden = false;
  el.textContent = message;
  el.dataset.error = String(error);
  el.classList.add('floating');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, error ? 9500 : 4600);
}

function listenForm(name, handler) {
  forms[name].addEventListener('submit', event => {
    event.preventDefault();
    try { handler(); } catch (error) { announce(error.message, true); }
  });
}

function readNumber(form, name, label, min = -10000, max = 10000) {
  const input = field(form, name);
  const { valueAsNumber: n } = input;
  if (!Number.isFinite(n) || n < min || n > max) {
    input.focus();
    if (min === max) throw new Error(`${label} debe ser ${f(min)}.`);
    throw new Error(`${label} debe estar entre ${f(min)} y ${f(max)}.`);
  }
  return n;
}

function write(form, values) {
  for (const [key, value] of Object.entries(values)) {
    const element = field(form, key);
    if (element) element.value = value ?? '';
  }
}

function roundCoordinate(value) { return Number(value.toFixed(4)); }
function planCoordinate(p) {
  return { x: Math.min(floor().width, roundCoordinate(p.x * floor().width)),
    y: Math.min(floor().height, roundCoordinate(p.y * floor().height)) };
}
function inside(p, width, height) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
}
function insideFloor(p, item) { return inside(p, item.width, item.height) && pointInOutline(p, item.outline); }
function wallInsideFloor(a, b, item) { return insideFloor(a, item) && insideFloor(b, item) && segmentInOutline(a, b, item.outline); }

function itemsOnFloor(item, index) {
  const router = state.building.router;
  return [
    ...item.walls.flatMap(w => [w.a, w.b]), ...item.points, ...(item.outline?.vertices ?? []),
    ...(router?.floor === index ? [router] : []),
    ...state.building.positions.filter(p => p.floor === index)
  ];
}

function setMode(mode) {
  state.mode = mode;
  state.marks = [];
  state.wallStart = null;
  state.wallPreview = null;
  state.outlineDraft = [];
  state.outlineHover = null;
  wallGesture = null;
  if (state.draft) state.selection = null;
  state.draft = null;
}

function pulse() {
  canvas.classList.remove('recalc');
  void canvas.offsetWidth;
  canvas.classList.add('recalc');
}

function selectFloor(index) {
  state.activeFloor = index;
  state.selection = null;
  setMode(ready(floor()) ? 'select' : 'calibration');
  write('calibration', { metres: '' });
  render();
  const tabs = $('#floor-tabs');
  const selected = tabs.children[index];
  if (selected) tabs.scrollLeft = selected.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - selected.clientWidth) / 2;
  pulse();
}

function renderPlan() {
  for (const button of $$('[data-mode]')) {
    if (button === canvas) continue;
    const mode = button.dataset.mode;
    button.setAttribute('aria-pressed', String(state.mode === mode));
    button.disabled = !ready(floor());
    if (mode === 'router') button.textContent = state.building.router ? 'Mover router' : 'Colocar router';
  }
  const hints = {
    select: 'Toca un muro o punto para editarlo. También puedes usar la lista de elementos.',
    wall: state.draft ? 'Completa el muro en Elementos del plano.' :
      state.wallPreview ? 'Suelta para colocar el muro.' :
      state.wallStart ? 'Marca el segundo extremo o arrastra para dibujar.' :
      'Mantén presionado y arrastra para dibujar. El muro se guarda al soltar.',
    point: 'Toca el lugar que quieres evaluar. Puedes cambiar su nombre en Elementos del plano.',
    router: state.building.router ? 'Toca otra posición disponible para mover el router.' :
      'Toca una posición disponible en este piso para colocar el router.',
    calibration: state.marks.length === 2 ? 'Ingresa la distancia real entre las marcas y confirma la escala.' :
      state.marks.length === 1 ? 'Marca el segundo extremo de una distancia conocida.' : 'Marca el primer extremo de una distancia conocida.',
    crop: state.marks.length ? 'Marca la esquina opuesta del recorte.' : 'Marca una esquina de la vista que quieres usar.',
    outline: state.outlineDraft.length >= 3 ? 'Toca el primer vértice o pulsa Cerrar contorno.' :
      'Marca las esquinas de la vivienda una por una.'
  };
  $('#map-hint').textContent = hints[state.mode];
  canvas.dataset.mode = state.mode;
  $('#calibration-form').hidden = state.mode !== 'calibration';
  const coverage = paintMap(canvas, state);
  const status = $('#coverage-status');
  const router = state.building.router;
  status.hidden = !state.heat || !router || !ready(floor()) ||
    (pathReady(state.building, router.floor, state.activeFloor) && coverage > DISPLAY_CUTOFF_DBM);
  if (!status.hidden) status.textContent = !pathReady(state.building, router.floor, state.activeFloor)
    ? 'Confirma la escala de los pisos intermedios para proyectar la señal.'
    : `La señal estimada no supera −90 dBm en ${floorName(state.activeFloor)}; el mapa ya no la colorea.`;
}

function renderControls() {
  const item = floor();
  const background = item.background;
  const band = BANDS[state.band];
  const bands = state.building.bands[state.band];
  $('#floor-count').textContent = `${state.building.count} ${state.building.count === 1 ? 'piso' : 'pisos'}`;
  write('building', { floorHeight: state.building.floorHeight });
  field('building', 'floorHeight').disabled = state.building.count === 1;
  forms.building.querySelector('button[type="submit"]').disabled = state.building.count === 1;
  write('dimensions', { width: item.width, height: item.height });
  write('band', bands);
  const tabs = $('#floor-tabs');
  while (tabs.children.length < state.building.count) {
    const button = document.createElement('button');
    button.type = 'button';
    tabs.append(button);
  }
  while (tabs.children.length > state.building.count) tabs.lastElementChild.remove();
  for (const [index, button] of [...tabs.children].entries()) {
    button.dataset.floor = String(index);
    button.textContent = floorName(index);
    button.setAttribute('aria-pressed', String(state.activeFloor === index));
  }
  $('#add-floor').setAttribute('aria-label', `Agregar piso ${state.building.count + 1}`);
  $('#add-floor').title = `Agregar piso ${state.building.count + 1}`;
  $('#delete-floor').disabled = state.building.count <= 1;
  $('#delete-floor').setAttribute('aria-label', `Eliminar ${floorName(state.activeFloor)}`);
  $('#delete-floor').title = `Eliminar ${floorName(state.activeFloor)}`;
  for (const button of $$('[data-band]')) button.setAttribute('aria-pressed', String(button.dataset.band === state.band));
  for (const label of $$('[data-band-label]')) label.textContent = band.label;
  for (const [name, route] of [['draw', 'draw'], ['import', 'import']]) {
    $(`#route-${name}`).setAttribute('aria-pressed', String(item.route === route));
  }
  $('#import-panel').hidden = item.route !== 'import';
  $('#dimensions-form').hidden = item.route !== 'draw';
  $('#import-status').textContent = background
    ? `${background.name} · ${background.calibrated ? `${f(item.width)} × ${f(item.height)} m` : 'escala pendiente'}${background.note ? ` · ${background.note}` : ''}`
    : 'Puedes subir una imagen o un dibujo técnico en formato DWG.';
  $('#crop').disabled = !background;
  $('#calibrate').disabled = !background;
  const reference = ready(item) ? `${f(item.width)} × ${f(item.height)} m` : 'Escala pendiente';
  $('#plan-meta').textContent = `${floorName(state.activeFloor)} · ${reference} · ${band.label}`;
}

function selectedElement() {
  if (state.draft) return state.draft;
  const { selection } = state;
  if (selection?.kind === 'wall') return floor().walls.find(item => item.id === selection.id);
  if (selection?.kind === 'point') return floor().points.find(item => item.id === selection.id);
  if (selection?.kind === 'router') return state.building.router?.floor === state.activeFloor ? state.building.router : {};
  return null;
}

function option(value, label) { return new Option(label, value); }

function renderEditor() {
  const item = floor();
  const selected = selectedElement();
  const kind = state.draft?.kind ?? state.selection?.kind;
  const list = $('#element-list');
  const enabled = ready(item);
  list.replaceChildren(option('', 'Elegir muro o punto'),
    ...item.walls.map((w, i) => option(w.id, `Muro ${i + 1} · ${MATERIALS[w.material].label}`)),
    ...item.points.map(p => option(p.id, p.name)),
    option('new-wall', 'Nuevo muro por coordenadas'), option('new-point', 'Nuevo punto por coordenadas'));
  if (state.building.router?.floor === state.activeFloor) list.add(option('router', 'Router'));
  list.value = state.selection?.id ?? '';
  list.disabled = !enabled;
  $('#edit-router').disabled = !enabled;
  $('#element-form').hidden = !selected || !enabled;
  $('#editor-note').textContent = !enabled ? 'Confirma la escala para editar los elementos.' :
    `${item.walls.length} ${item.walls.length === 1 ? 'muro' : 'muros'} y ${item.points.length} ${item.points.length === 1 ? 'punto' : 'puntos'} en el piso visible. El origen está arriba a la izquierda.`;
  if (!selected || !enabled) return;
  const wall = kind === 'wall';
  $('#wall-fields').hidden = !wall;
  $('#name-field').hidden = kind !== 'point';
  for (const end of $$('.end-field')) end.hidden = !wall;
  $('#coord-x-label').textContent = wall ? 'Inicio desde la izquierda (metros)' : 'Desde la izquierda (metros)';
  $('#coord-y-label').textContent = wall ? 'Inicio desde arriba (metros)' : 'Desde arriba (metros)';
  $('#delete-element').hidden = Boolean(state.draft) || (kind === 'router' && selected.x === undefined);
  $('#apply-element').textContent = wall ? 'Guardar muro' : kind === 'point' ? 'Guardar punto' : 'Aplicar posición';
  write('element', wall ? {
    material: selected.material, thickness: selected.thickness == null ? '' : Number((selected.thickness * 100).toPrecision(10)),
    loss24: selected.losses?.['2.4'], loss5: selected.losses?.['5'],
    x: selected.a?.x, y: selected.a?.y, x2: selected.b?.x, y2: selected.b?.y
  } : { pointName: selected.name, x: selected.x, y: selected.y });
}

function selectedWall() {
  if (state.mode !== 'select' || state.selection?.kind !== 'wall' || state.draft) return null;
  return floor().walls.find(wall => wall.id === state.selection.id) ?? null;
}

function renderQuickWall() {
  const wall = selectedWall();
  const drawing = state.mode === 'wall' && ready(floor());
  quickWallForm.hidden = !drawing && !wall;
  if (quickWallForm.hidden) return;
  $('#quick-wall-title').textContent = wall ? 'Editar muro' : 'Muro manual';
  $('#quick-wall-subtitle').textContent = wall ? 'Cambios en este muro' : 'Arrastra sobre el plano';
  $('#wall-snap-controls').hidden = !drawing;
  $('#quick-wall-details').hidden = !wall;
  $('#quick-wall-edit').hidden = !drawing || !state.selection?.id || !floor().walls.some(item => item.id === state.selection.id);
  $('#quick-wall-save').hidden = !wall;
  $('#quick-wall-delete').hidden = !wall;
  quickWallField('material').value = wall?.material ?? quickDefaults.material;
  quickWallField('thickness').value = wall ? Number((wall.thickness * 100).toPrecision(10)) : quickDefaults.thickness;
  if (wall) {
    for (const [name, value] of Object.entries({
      loss24: wall.losses['2.4'], loss5: wall.losses['5'],
      x: wall.a.x, y: wall.a.y, x2: wall.b.x, y2: wall.b.y
    })) quickWallField(name).value = value;
  } else $('#quick-wall-details').open = false;
}

function renderOutlinePanel() {
  const visible = state.mode === 'outline' && ready(floor());
  $('#outline-panel').hidden = !visible;
  if (!visible) return;
  const count = state.outlineDraft.length;
  $('#outline-count').textContent = count ? `${count} ${count === 1 ? 'esquina marcada' : 'esquinas marcadas'}` :
    floor().outline ? 'Marca esquinas para reemplazarlo' : 'Marca las esquinas de la vivienda';
  $('#outline-undo').disabled = count === 0;
  $('#outline-close').disabled = count < 3;
  $('#outline-remove').disabled = !floor().outline;
}

function addOutlineVertex(p) {
  if (!inside(p, floor().width, floor().height)) throw new Error('La esquina debe quedar dentro de las medidas del plano.');
  const vertices = state.outlineDraft;
  if (vertices.length && Math.hypot(p.x - vertices.at(-1).x, p.y - vertices.at(-1).y) < EPSILON) {
    throw new Error('Marca una esquina distinta de la anterior.');
  }
  vertices.push(p);
  state.outlineHover = null;
  renderOutlinePanel();
  renderPlan();
}

function finishOutline() {
  const item = floor();
  const vertices = state.outlineDraft;
  if (!validOutline(vertices)) throw new Error('El contorno necesita al menos tres esquinas y no puede cruzarse consigo mismo.');
  const material = $('#outline-material').value;
  if (!MATERIALS[material]) throw new Error('Selecciona un material exterior.');
  const thicknessInput = $('#outline-thickness');
  const centimetres = thicknessInput.valueAsNumber;
  if (!Number.isFinite(centimetres) || centimetres < 0.01 || centimetres > 10000) {
    thicknessInput.focus();
    throw new Error('El grosor exterior debe estar entre 0,01 y 10.000 cm.');
  }
  const readLoss = (id, band) => {
    const input = $(id);
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      input.focus();
      throw new Error(`La pérdida exterior a ${band} debe estar entre 0 y 1.000 dB.`);
    }
    return value;
  };
  const outline = { vertices: vertices.map(p => ({ ...p })), material,
    thickness: centimetres / 100,
    losses: { '2.4': readLoss('#outline-loss-24', '2,4 GHz'), '5': readLoss('#outline-loss-5', '5 GHz') } };
  if (item.points.some(p => !pointInOutline(p, outline)) ||
      (state.building.router?.floor === state.activeFloor && !pointInOutline(state.building.router, outline)) ||
      state.building.positions.some(p => p.floor === state.activeFloor && !pointInOutline(p, outline)) ||
      item.walls.some(w => !segmentInOutline(w.a, w.b, outline))) {
    throw new Error('Hay elementos fuera del contorno. Muévelos o bórralos antes de cerrarlo.');
  }
  item.outline = outline;
  state.selection = null;
  setMode('select');
  render();
  announce('Contorno exterior guardado. Sus lados ahora cuentan como muros en el cálculo.');
}

function readQuickNumber(name, label, min, max) {
  const input = quickWallField(name);
  const n = input.valueAsNumber;
  if (!Number.isFinite(n) || n < min || n > max) {
    input.focus();
    throw new Error(`${label} debe estar entre ${f(min)} y ${f(max)}.`);
  }
  return n;
}

function quickWallProperties() {
  const material = quickWallField('material').value;
  if (!MATERIALS[material]) throw new Error('Selecciona el material del muro.');
  const thickness = readQuickNumber('thickness', 'El grosor en centímetros', 0.01, 10000);
  return { material, thickness };
}

function snappedWallEnd(a, b) {
  const rect = canvas.getBoundingClientRect();
  const view = viewport(rect.width, rect.height, floor());
  return snapWallEnd(a, b, view.w / floor().width, view.h / floor().height, {
    horizontal: $('#snap-horizontal').checked, vertical: $('#snap-vertical').checked
  });
}

function addDrawnWall(a, b) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < EPSILON) throw new Error('El muro necesita dos extremos distintos.');
  if (!wallInsideFloor(a, b, floor())) throw new Error('El muro debe quedar dentro del contorno de la vivienda.');
  if (floor().walls.some(wall => sameWall(wall, { a, b }))) throw new Error('Ya existe un muro con esos dos extremos.');
  const { material, thickness } = quickWallProperties();
  const id = `wall-${++nextId}`;
  floor().walls = [...floor().walls, {
    id, a, b, material, thickness: thickness / 100, losses: { ...MATERIALS[material].losses }
  }];
  state.selection = { kind: 'wall', id };
  render();
  announce('Muro dibujado. Puedes arrastrar otro o seleccionarlo para editar sus detalles.');
}

function referenceDetails(result, p, router) {
  const angle = result.angle === null ? 'sin dirección horizontal' : `${f(result.angle)}°`;
  const slabs = Math.abs(p.floor - router.floor);
  const walls = result.walls.map(w => `<span class="detail-line">${w.id.startsWith('exterior-') ? 'Exterior · ' : ''}${MATERIALS[w.material].label}, ${floorName(w.floor)} · ${f(w.loss)} dB</span>`).join('');
  return `<details><summary>${result.walls.length} ${result.walls.length === 1 ? "muro" : "muros"}${slabs ? ` y ${slabs} ${slabs === 1 ? 'losa' : 'losas'}` : ''}</summary>
    <span class="detail-line">Δx ${f(p.x - router.x)} m · Δy ${f(p.y - router.y)} m</span>
    <span class="detail-line">Δz ${f((p.floor - router.floor) * state.building.floorHeight)} m · θ ${angle}</span>
    <span class="detail-line">Espacio libre a 1 m · ${f(result.fspl)} dB</span>
    <span class="detail-line">Señal a 1 m · ${f(result.reference)} dBm</span>
    <span class="detail-line">Distancia · ${f(result.distanceLoss)} dB</span>
    <span class="detail-line">Muros · ${f(result.wallsLoss)} dB</span>
    <span class="detail-line">${slabs === 1 ? 'Losa' : `Losas (${slabs})`} · ${f(result.slab)} dB</span>${walls}</details>`;
}

function renderResults() {
  const { building, band } = state;
  const targets = points();
  const router = building.router?.floor < building.count ? building.router : null;
  $('#point-summary').textContent = router ? `Router en ${floorName(router.floor).toLowerCase()} · (${f(router.x)} m, ${f(router.y)} m)` :
    'Coloca el router en el plano para calcular la señal.';
  $('#save-position').disabled = !router || !ready(building.floors[router.floor]);
  const output = $('#point-results');
  if (!targets.length || !router || !ready(building.floors[router.floor])) {
    output.innerHTML = `<p>${!router ? 'Selecciona Colocar router y marca su ubicación.' :
      !targets.length ? 'Marca al menos un punto de interés.' : 'Confirma la escala del piso del router.'}</p>`;
  } else {
    const rows = targets.map(p => {
      const name = `<td>${esc(p.name)}<small>${floorName(p.floor)}</small></td>`;
      if (!pathReady(building, router.floor, p.floor)) return `<tr>${name}<td colspan="3">Escala pendiente en el trayecto entre pisos</td></tr>`;
      const result = estimate(router, p, building, band);
      return `<tr>${name}<td class="numeric">${f(result.d)} m</td><td>${referenceDetails(result, p, router)}</td>
        <td class="numeric">${dot(result.signal)}<strong>${f(result.signal)}</strong></td></tr>`;
    });
    output.innerHTML = `<div class="table-shell"><table aria-label="Resultados estimados por punto">
      <thead><tr><th scope="col">Punto</th><th scope="col">Distancia</th><th scope="col">Obstáculos y pérdidas</th><th scope="col">Señal (dBm)</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }
  renderComparison(targets);
}

function renderComparison(targets) {
  const saved = placements();
  const { building, band } = state;
  const output = $('#comparison');
  if (!saved.length) { output.innerHTML = '<p>Guarda dos posiciones distintas para compararlas.</p>'; return; }
  const usable = targets.length && saved.every(position =>
    targets.every(target => pathReady(building, position.floor, target.floor)));
  const results = usable ? comparePositions(saved, targets, building, band) : saved.map(position => ({ position }));
  const leader = results[0];
  const ties = usable ? results.filter(result => Math.abs(result.minimum - leader.minimum) < EPSILON) : [];
  let summary = 'Marca puntos de interés y confirma la escala en todos los pisos del trayecto.';
  if (usable) {
    if (saved.length === 1) summary = 'Guarda otra posición para comparar.';
    else if (ties.length > 1) summary = `Empate en ${f(leader.minimum)} dBm · ${ties.map(r => esc(r.position.name)).join(', ')}.`;
    else summary = `${esc(leader.position.name)} deja su punto más débil con más señal · ${f(leader.minimum)} dBm en ${esc(targets[leader.worstIndex].name)}.`;
  }
  const cols = targets.map(p => `<th scope="col">${esc(p.name)}<small>${floorName(p.floor)}</small></th>`).join('');
  const cell = (value, strong = false) => `<td class="numeric">${usable ?
    `${dot(value)}${strong ? `<strong>${f(value)}</strong>` : f(value)}` : '–'}</td>`;
  const rows = results.map(result => {
    const { position: p, values, minimum } = result;
    const best = usable && saved.length > 1 && ties.includes(result);
    return `<tr${best ? ' class="is-best"' : ''}><td>${esc(p.name)}
    <small>${floorName(p.floor)} · ${f(p.x)}, ${f(p.y)} m</small>
    <div class="position-actions"><button class="button" type="button" data-position-action="use" data-id="${p.id}">Usar</button>
    <button class="button danger" type="button" data-position-action="remove" data-id="${p.id}">Borrar</button></div></td>
    ${cell(minimum, true)}${targets.map((_, i) => cell(values?.[i])).join('')}</tr>`;
  });
  output.innerHTML = `<p class="result-summary">${summary}</p><div class="table-shell"><table aria-label="Matriz de señal estimada por posición y punto en dBm">
    <thead><tr><th scope="col">Posición</th><th scope="col">Señal más baja (dBm)</th>${cols}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function render() { renderControls(); renderEditor(); renderQuickWall(); renderOutlinePanel(); renderPlan(); renderResults(); }

for (const [key, material] of Object.entries(MATERIALS)) field('element', 'material').add(option(key, material.label));
field('element', 'material').add(option('', 'Elegir material'), 0);
for (const [key, material] of Object.entries(MATERIALS)) quickWallField('material').add(option(key, material.label));
for (const [key, material] of Object.entries(MATERIALS)) $('#outline-material').add(option(key, material.label));
$('#outline-material').value = 'ladrillo';
$('#outline-loss-24').value = MATERIALS.ladrillo.losses['2.4'];
$('#outline-loss-5').value = MATERIALS.ladrillo.losses['5'];
$('#outline-material').addEventListener('change', event => {
  const material = MATERIALS[event.target.value];
  $('#outline-loss-24').value = material.losses['2.4'];
  $('#outline-loss-5').value = material.losses['5'];
});
field('element', 'material').addEventListener('change', () => {
  const material = MATERIALS[field('element', 'material').value];
  write('element', { loss24: material?.losses['2.4'], loss5: material?.losses['5'] });
});
quickWallField('material').addEventListener('change', () => {
  const material = quickWallField('material').value;
  if (selectedWall()) {
    quickWallField('loss24').value = MATERIALS[material].losses['2.4'];
    quickWallField('loss5').value = MATERIALS[material].losses['5'];
  } else quickDefaults.material = material;
});
quickWallField('thickness').addEventListener('input', () => {
  if (!selectedWall() && quickWallField('thickness').valueAsNumber > 0) {
    quickDefaults.thickness = quickWallField('thickness').valueAsNumber;
  }
});
quickWallForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const { material, thickness } = quickWallProperties();
    const wall = selectedWall();
    if (!wall) { Object.assign(quickDefaults, { material, thickness }); return; }
    const item = floor();
    const a = { x: readQuickNumber('x', 'Inicio X', 0, item.width), y: readQuickNumber('y', 'Inicio Y', 0, item.height) };
    const b = { x: readQuickNumber('x2', 'Final X', 0, item.width), y: readQuickNumber('y2', 'Final Y', 0, item.height) };
    if (Math.hypot(b.x - a.x, b.y - a.y) < EPSILON) throw new Error('El muro necesita dos extremos distintos.');
    if (!wallInsideFloor(a, b, item)) throw new Error('El muro debe quedar dentro del contorno de la vivienda.');
    if (item.walls.some(other => other.id !== wall.id && sameWall(other, { a, b }))) throw new Error('Ya existe un muro con esos dos extremos.');
    const losses = { '2.4': readQuickNumber('loss24', 'La pérdida a 2,4 GHz', 0, 1000),
      '5': readQuickNumber('loss5', 'La pérdida a 5 GHz', 0, 1000) };
    item.walls = item.walls.map(other => other.id === wall.id
      ? { ...wall, a, b, material, thickness: thickness / 100, losses } : other);
    render();
    announce('Muro actualizado.');
  } catch (error) { announce(error.message, true); }
});
$('#quick-wall-edit').addEventListener('click', () => {
  setMode('select');
  renderEditor();
  renderQuickWall();
  renderPlan();
});
$('#outline-undo').addEventListener('click', () => {
  state.outlineDraft.pop();
  renderOutlinePanel();
  renderPlan();
});
$('#outline-add-point').addEventListener('click', () => {
  try {
    const x = $('#outline-x').valueAsNumber, y = $('#outline-y').valueAsNumber;
    addOutlineVertex({ x, y });
    $('#outline-x').value = '';
    $('#outline-y').value = '';
    $('#outline-x').focus();
  } catch (error) { announce(error.message, true); }
});
$('#outline-close').addEventListener('click', () => {
  try { finishOutline(); } catch (error) { announce(error.message, true); }
});
$('#outline-remove').addEventListener('click', () => {
  floor().outline = null;
  state.outlineDraft = [];
  render();
  announce('Contorno exterior quitado.');
});

listenForm('building', () => {
  const building = state.building;
  const floorHeight = building.count > 1 ? readNumber('building', 'floorHeight', 'La altura', 0.01) : building.floorHeight;
  building.floorHeight = floorHeight;
  render();
  announce('Vivienda actualizada.');
});

listenForm('dimensions', () => {
  const width = readNumber('dimensions', 'width', 'El ancho', 0.01);
  const height = readNumber('dimensions', 'height', 'El fondo', 0.01);
  if (!itemsOnFloor(floor(), state.activeFloor).every(p => inside(p, width, height))) {
    throw new Error('Las nuevas medidas dejarían elementos fuera del plano. Ajusta o mueve esos elementos primero.');
  }
  Object.assign(floor(), { width, height });
  setMode('select');
  render();
});

listenForm('band', () => {
  const eirp = readNumber('band', 'eirp', 'La potencia del router', -1000, 1000);
  const gain = readNumber('band', 'gain', 'El aporte de la antena receptora', -1000, 1000);
  const exponent = readNumber('band', 'exponent', 'El valor de caída con la distancia', 0.01, 100);
  const slab = readNumber('band', 'slab', 'La pérdida entre pisos', 0, 1000);
  state.building.bands[state.band] = { ...state.building.bands[state.band], eirp, gain, exponent, slab };
  render();
  announce(`Parámetros de ${BANDS[state.band].label} actualizados.`);
});

$('#floor-tabs').addEventListener('click', event => {
  if (event.target.matches('[data-floor]')) selectFloor(Number(event.target.dataset.floor));
});
$('#add-floor').addEventListener('click', () => {
  const index = state.building.count;
  ensureFloors(index + 1);
  state.building.count = index + 1;
  selectFloor(index);
  announce(`${floorName(index)} agregado. Puedes modificar sus medidas y dibujar su contorno.`);
});
$('#delete-floor').addEventListener('click', () => {
  const index = state.activeFloor;
  const building = state.building;
  if (building.count <= 1) return;
  const item = floor();
  const hasContent = Boolean(item.background || item.outline || item.walls.length || item.points.length ||
    building.router?.floor === index || building.positions.some(position => position.floor === index));
  if (hasContent && !window.confirm(`¿Eliminar ${floorName(index)}? Se borrarán su plano, sus elementos y las posiciones guardadas allí. Los pisos superiores se renumerarán.`)) return;
  state.building = removeFloor(building, index);
  selectFloor(Math.min(index, state.building.count - 1));
  announce(`${floorName(index)} eliminado. Los pisos superiores se renumeraron.`);
});
$('#band-tabs').addEventListener('click', event => {
  if (!event.target.matches('[data-band]')) return;
  state.band = event.target.dataset.band;
  renderControls();
  renderPlan();
  renderResults();
  pulse();
});
for (const button of $$('.tool[data-mode]')) button.addEventListener('click', () => {
  setMode(button.dataset.mode);
  if (state.mode === 'outline') {
    const current = floor().outline;
    const material = current?.material ?? 'ladrillo';
    $('#outline-material').value = material;
    $('#outline-thickness').value = current ? Number((current.thickness * 100).toPrecision(10)) : 15;
    $('#outline-loss-24').value = current?.losses['2.4'] ?? MATERIALS[material].losses['2.4'];
    $('#outline-loss-5').value = current?.losses['5'] ?? MATERIALS[material].losses['5'];
  }
  renderEditor();
  renderQuickWall();
  renderOutlinePanel();
  renderPlan();
});
$('#heat').addEventListener('change', event => { state.heat = event.target.checked; renderPlan(); pulse(); });

$('#route-draw').addEventListener('click', () => {
  const item = floor();
  if (item.background && !window.confirm('¿Quitar el fondo importado de este piso? Se conservan las dimensiones y los elementos guardados.')) return;
  targetMarks.delete(item);
  Object.assign(item, { route: 'draw', background: null });
  setMode('wall');
  render();
});
$('#route-import').addEventListener('click', () => {
  floor().route = 'import';
  if (!ready(floor())) setMode('calibration');
  render();
});

async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('La imagen no contiene una vista válida.');
  return image;
}

async function imageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

async function convertDwg(file) {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cad-worker.mjs', import.meta.url), { type: 'module' });
    const finish = (callback, value) => {
      clearTimeout(timeout);
      worker.terminate();
      callback(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error('El DWG tardó demasiado. Prueba con una exportación en PNG.')), 25000);
    worker.onmessage = ({ data }) => {
      if (data.error) finish(reject, new Error(data.error));
      else finish(resolve, data);
    };
    worker.onerror = () => finish(reject, new Error('Falló el conversor DWG. Prueba con una exportación en PNG.'));
    worker.postMessage(buffer, [buffer]);
  });
}

function background(image, name, note = '') {
  return { image, name, note, calibrated: false, crop: { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight } };
}

$('#file').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const extension = file.name.split('.').at(-1).toLowerCase();
  const item = floor();
  const target = state.activeFloor;
  const building = state.building;
  const request = Symbol();
  targetMarks.set(item, request);
  try {
    if (!['dwg', 'png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension) || !file.size || file.size > 30 * 1024 ** 2) {
      throw new Error('Elige un DWG, PNG, JPG, WebP o BMP de hasta 30 MB.');
    }
    announce(`Abriendo ${file.name} en ${floorName(target).toLowerCase()}.`);
    let image;
    let note = '';
    if (extension === 'dwg') {
      const result = await convertDwg(file);
      image = await imageFromBlob(new Blob([result.svg], { type: 'image/svg+xml' }));
      note = `${result.version} · ${f(result.entities)} entidades recuperadas`;
    } else {
      try { image = await imageFromBlob(file); } catch { throw new Error('El navegador no pudo abrir esa imagen. Prueba con un PNG o JPG válido.'); }
    }
    if (targetMarks.get(item) !== request || state.building !== building) return;
    item.background = background(image, file.name, note);
    item.route = 'import';
    if (state.activeFloor === target) {
      state.selection = null;
      setMode('calibration');
      write('calibration', { metres: '' });
    }
    render();
    announce(`Vista cargada en ${floorName(target).toLowerCase()}. Recorta si el archivo trae varias vistas y marca una escala.`);
  } catch (error) {
    if (targetMarks.get(item) === request && state.building === building) announce(error.message, true);
  }
});

$('#calibrate').addEventListener('click', () => {
  setMode('calibration');
  write('calibration', { metres: '' });
  render();
});
$('#crop').addEventListener('click', () => { setMode('crop'); render(); });
listenForm('calibration', () => {
  const item = floor();
  if (!item.background || state.marks.length !== 2) throw new Error('Marca dos puntos de una distancia conocida sobre la imagen.');
  const metres = readNumber('calibration', 'metres', 'La distancia marcada', 0.01);
  const { width: pixelsX, height: pixelsY } = item.background.crop;
  let { width, height } = calibratedDimensions(pixelsX, pixelsY, ...state.marks, metres);
  width = roundCoordinate(width);
  height = roundCoordinate(height);
  if (Math.min(width, height) < 0.01 || Math.max(width, height) > 10000) {
    throw new Error('La escala produce dimensiones fuera del rango admitido. Revisa la distancia y los dos puntos.');
  }
  if (!itemsOnFloor(item, state.activeFloor).every(p => inside(p, width, height))) {
    throw new Error('La escala dejaría elementos fuera del plano. Corrige la distancia, mueve los elementos desde Dibujar o usa un piso en blanco.');
  }
  Object.assign(item, { width, height });
  item.background.calibrated = true;
  setMode('select');
  render();
  announce(`Escala confirmada para ${floorName(state.activeFloor).toLowerCase()}.`);
});

function markCrop(p) {
  state.marks.push(p);
  if (state.marks.length === 1) { renderPlan(); return; }
  const [a, b] = state.marks;
  const crop = floor().background.crop;
  const width = crop.width * Math.abs(b.x - a.x);
  const height = crop.height * Math.abs(b.y - a.y);
  if (width < 5 || height < 5) {
    state.marks.pop();
    announce('El recorte debe tener ancho y alto. Marca una esquina más alejada.', true);
    return;
  }
  Object.assign(floor().background, {
    calibrated: false, crop: {
      x: crop.x + crop.width * Math.min(a.x, b.x),
      y: crop.y + crop.height * Math.min(a.y, b.y), width, height
    }
  });
  state.selection = null;
  setMode('calibration');
  write('calibration', { metres: '' });
  render();
}

function markCalibration(p) {
  if (state.marks.length === 2) state.marks = [];
  if (state.marks.length && Math.hypot(state.marks[0].x - p.x, state.marks[0].y - p.y) < EPSILON) {
    announce('Marca un segundo punto distinto para calcular la escala.', true);
    return;
  }
  state.marks.push(p);
  renderPlan();
}

function useSelection(kind, id) {
  setMode('select');
  state.selection = { kind, id };
  renderEditor();
  renderQuickWall();
  renderPlan();
}

function placeRouter(p) {
  if (!insideFloor(p, floor())) throw new Error('El router debe quedar dentro del contorno de la vivienda.');
  state.building.router = { ...p, floor: state.activeFloor };
  state.selection = { kind: 'router', id: 'router' };
  render();
  pulse();
}

canvas.addEventListener('pointerdown', event => {
  if (state.mode !== 'wall' || !ready(floor()) || event.button !== 0) return;
  const hit = canvasPoint(canvas, event, floor());
  if (!hit) return;
  if (!insideFloor(planCoordinate(hit), floor())) { announce('Empieza el muro dentro del contorno.', true); return; }
  canvas.setPointerCapture(event.pointerId);
  wallGesture = { pointerId: event.pointerId, a: planCoordinate(hit), x: event.clientX, y: event.clientY, moved: false };
});
canvas.addEventListener('pointermove', event => {
  if (!wallGesture || event.pointerId !== wallGesture.pointerId) return;
  if (Math.hypot(event.clientX - wallGesture.x, event.clientY - wallGesture.y) < 5) return;
  wallGesture.moved = true;
  state.wallStart = null;
  const hit = canvasPoint(canvas, event, floor());
  if (!hit) return;
  state.wallPreview = { a: wallGesture.a, b: snappedWallEnd(wallGesture.a, planCoordinate(hit)) };
  renderPlan();
});
canvas.addEventListener('pointerup', event => {
  if (!wallGesture || event.pointerId !== wallGesture.pointerId) return;
  const gesture = wallGesture;
  wallGesture = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  state.wallPreview = null;
  if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 5) return;
  suppressWallClick = true;
  setTimeout(() => { suppressWallClick = false; }, 0);
  state.wallStart = null;
  const hit = canvasPoint(canvas, event, floor());
  if (!hit) { renderPlan(); announce('Termina el muro dentro del plano.', true); return; }
  try { addDrawnWall(gesture.a, snappedWallEnd(gesture.a, planCoordinate(hit))); }
  catch (error) { renderPlan(); announce(error.message, true); }
});
canvas.addEventListener('pointercancel', event => {
  if (!wallGesture || event.pointerId !== wallGesture.pointerId) return;
  wallGesture = null;
  state.wallPreview = null;
  renderPlan();
});
canvas.addEventListener('pointermove', event => {
  if (state.mode !== 'outline' || !state.outlineDraft.length) return;
  const hit = canvasPoint(canvas, event, floor());
  state.outlineHover = hit ? planCoordinate(hit) : null;
  renderPlan();
});

canvas.addEventListener('click', event => {
  if (suppressWallClick) { suppressWallClick = false; return; }
  const hit = canvasPoint(canvas, event, floor());
  if (!hit) { announce('Marca una ubicación dentro del borde del plano.', true); return; }
  if (state.mode === 'crop') { markCrop(hit); return; }
  if (state.mode === 'calibration') { markCalibration(hit); return; }
  if (!ready(floor())) return;
  const p = planCoordinate(hit);
  if (state.mode === 'outline') {
    const vertices = state.outlineDraft;
    if (vertices.length >= 3) {
      const rect = canvas.getBoundingClientRect();
      const view = viewport(rect.width, rect.height, floor());
      if (Math.hypot((p.x - vertices[0].x) * view.w / floor().width,
        (p.y - vertices[0].y) * view.h / floor().height) <= 16) {
        try { finishOutline(); } catch (error) { announce(error.message, true); }
        return;
      }
    }
    try { addOutlineVertex(p); } catch (error) { announce(error.message, true); }
    return;
  }
  if (state.mode === 'router') {
    try { placeRouter(p); } catch (error) { announce(error.message, true); }
    return;
  }
  if (state.mode === 'wall') {
    if (!insideFloor(p, floor())) { announce('Marca el muro dentro del contorno.', true); return; }
    if (!state.wallStart) { state.wallStart = p; renderPlan(); return; }
    if (Math.hypot(p.x - state.wallStart.x, p.y - state.wallStart.y) < EPSILON) {
      announce('El muro necesita dos extremos distintos.', true);
      return;
    }
    const a = state.wallStart;
    state.wallStart = null;
    try { addDrawnWall(a, snappedWallEnd(a, p)); }
    catch (error) { renderPlan(); announce(error.message, true); }
    return;
  }
  if (state.mode === 'point') {
    if (!insideFloor(p, floor())) { announce('Marca el punto dentro del contorno.', true); return; }
    const name = window.prompt('Nombre del punto de interés:');
    if (name === null) return;
    const id = `point-${++nextId}`;
    let index = floor().points.length + 1;
    while (floor().points.some(item => item.name === `Punto ${index}`)) index++;
    floor().points.push({ ...p, id, name: name.trim() || `Punto ${index}`, floor: state.activeFloor });
    state.selection = { kind: 'point', id };
    render();
    pulse();
    return;
  }
  const router = state.building.router?.floor === state.activeFloor ? state.building.router : null;
  state.selection = hitTest(floor(), p, canvas, router);
  renderEditor();
  renderQuickWall();
  renderPlan();
});

$('#element-list').addEventListener('change', event => {
  const id = event.currentTarget.value;
  if (id === 'router') { useSelection('router', id); return; }
  if (id === 'new-wall' || id === 'new-point') {
    setMode('select');
    const kind = id === 'new-wall' ? 'wall' : 'point';
    state.selection = { kind, id };
    state.draft = { kind };
    renderEditor();
    renderQuickWall();
    renderPlan();
    return;
  }
  if (floor().walls.some(wall => wall.id === id)) { useSelection('wall', id); return; }
  if (floor().points.some(point => point.id === id)) { useSelection('point', id); return; }
  state.selection = null;
  setMode('select');
  renderEditor();
  renderQuickWall();
  renderPlan();
});
$('#edit-router').addEventListener('click', () => useSelection('router', 'router'));

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (state.wallStart) { state.wallStart = null; renderPlan(); }
  else if (state.draft) { state.draft = null; state.selection = null; renderEditor(); renderPlan(); }
});
document.addEventListener('keydown', event => {
  if ((event.key === 'Delete' || event.key === 'Backspace') &&
      !/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) &&
      state.selection && !$('#delete-element').hidden) {
    $('#delete-element').click();
  }
});

listenForm('element', () => {
  const item = floor();
  const { kind, id } = state.selection;
  const wall = kind === 'wall';
  const a = {
    x: readNumber('element', 'x', 'La distancia desde la izquierda', 0, item.width),
    y: readNumber('element', 'y', 'La distancia desde arriba', 0, item.height)
  };
  if (!insideFloor(a, item)) throw new Error('La posición debe quedar dentro del contorno de la vivienda.');
  if (kind === 'router') { placeRouter(a); announce('Posición del router actualizada.'); return; }
  if (wall) {
    const b = { x: readNumber('element', 'x2', 'La distancia final desde la izquierda', 0, item.width),
      y: readNumber('element', 'y2', 'La distancia final desde arriba', 0, item.height) };
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPSILON) throw new Error('El muro necesita dos extremos distintos.');
    if (!wallInsideFloor(a, b, item)) throw new Error('El muro debe quedar dentro del contorno de la vivienda.');
    if (item.walls.some(w => w.id !== id && sameWall(w, { a, b }))) throw new Error('Ya existe un muro con esos dos extremos.');
    const material = field('element', 'material').value;
    if (!MATERIALS[material]) { field('element', 'material').focus(); throw new Error('Selecciona el material del muro.'); }
    const thickness = readNumber('element', 'thickness', 'El grosor en centímetros', 0.01, 10000) / 100;
    const losses = { '2.4': readNumber('element', 'loss24', 'La pérdida a 2,4 GHz', 0, 1000),
      '5': readNumber('element', 'loss5', 'La pérdida a 5 GHz', 0, 1000) };
    const key = state.draft ? `wall-${++nextId}` : id;
    const change = { a, b, material, thickness, losses, id: key };
    item.walls = state.draft ? [...item.walls, change] : item.walls.map(w => w.id === key ? change : w);
    setMode('select');
    state.selection = { kind, id: key };
    announce('Muro guardado.');
  } else {
    const name = field('element', 'pointName').value.trim();
    if (!name) { field('element', 'pointName').focus(); throw new Error('Ingresa un nombre para el punto.'); }
    const key = state.draft ? `point-${++nextId}` : id;
    const change = { ...a, name, id: key, floor: state.activeFloor };
    item.points = state.draft ? [...item.points, change] : item.points.map(p => p.id === key ? change : p);
    setMode('select');
    state.selection = { kind, id: key };
    announce('Punto guardado.');
  }
  render();
});
function deleteSelectedElement() {
  if (!state.selection) return;
  const { kind, id } = state.selection;
  if (kind === 'router') state.building.router = null;
  if (kind === 'wall') floor().walls = floor().walls.filter(w => w.id !== id);
  if (kind === 'point') floor().points = floor().points.filter(p => p.id !== id);
  state.selection = null;
  render();
  announce('Elemento borrado.');
}
$('#delete-element').addEventListener('click', deleteSelectedElement);
$('#quick-wall-delete').addEventListener('click', deleteSelectedElement);

listenForm('save', () => {
  const { building } = state;
  const router = building.router;
  if (!router || !ready(building.floors[router.floor])) throw new Error('Coloca el router en un piso con escala confirmada.');
  if (building.positions.some(p => p.floor === router.floor && Math.hypot(p.x - router.x, p.y - router.y) < EPSILON)) {
    throw new Error('Ya guardaste esta posición. Mueve el router a otro lugar para compararlos.');
  }
  const ordinal = ++nextId;
  const name = field('save', 'positionName').value.trim() || `Posición ${building.positions.length + 1}`;
  building.positions.push({ ...router, id: `position-${ordinal}`, name });
  write('save', { positionName: '' });
  renderResults();
  announce(`Posición «${name}» guardada.`);
});
$('#comparison').addEventListener('click', event => {
  const action = event.target.dataset.positionAction;
  if (!action) return;
  const { building } = state;
  const position = building.positions.find(p => p.id === event.target.dataset.id);
  if (action === 'remove') {
    building.positions = building.positions.filter(p => p !== position);
    renderResults();
    return;
  }
  if (!ready(building.floors[position.floor])) { announce('Confirma la escala de ese piso antes de usar la posición.', true); return; }
  selectFloor(position.floor);
  placeRouter({ x: position.x, y: position.y });
  announce(`Router movido a ${position.name}.`);
});

function occupied() {
  const { building } = state;
  return building.router || building.positions.length || building.floors.some(item => item.background || item.outline || item.walls.length || item.points.length);
}

async function loadExample(key) {
  const request = ++exampleRequest;
  if (occupied() && !window.confirm('¿Cargar otro escenario? Se reemplazarán los elementos y las posiciones de la sesión.')) return;
  const build = example(key);
  if (key === 'cad') {
    try {
      const names = ['planta-baja', 'planta-alta'];
      const images = await Promise.all(names.map(name => loadImage(`./assets/${name}.png`)));
      if (request !== exampleRequest) return;
      for (const [i, image] of images.entries()) {
        build.floors[i].route = 'import';
        build.floors[i].background = background(image, `${names[i]}.png`, 'Vista recortada del DWG de la entrega');
      }
    } catch {
      if (request === exampleRequest) announce('Los fondos de ejemplo no pudieron cargarse.', true);
      return;
    }
  }
  state.building = build;
  selectFloor(0);
  if (key === 'one' || key === 'two') { setMode('router'); renderPlan(); }
}

const exampleMenu = $('#example-options');
const exampleButton = $('#example-button');
function closeExampleMenu() {
  exampleMenu.hidden = true;
  exampleButton.setAttribute('aria-expanded', 'false');
}
exampleButton.addEventListener('click', () => {
  exampleMenu.hidden = !exampleMenu.hidden;
  exampleButton.setAttribute('aria-expanded', String(!exampleMenu.hidden));
});
exampleMenu.addEventListener('click', event => {
  const key = event.target.closest('[data-example]')?.dataset.example;
  if (!key) return;
  closeExampleMenu();
  void loadExample(key);
});
document.addEventListener('pointerdown', event => {
  if (!exampleMenu.hidden && !event.target.closest('.sample-picker')) closeExampleMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeExampleMenu(); });

// Tema claro / oscuro: se elige en la cabecera y se recuerda en este navegador.
const themeMeta = document.querySelector('meta[name="theme-color"]');
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function savedTheme() {
  try { const value = localStorage.getItem('ros-theme'); return value === 'light' || value === 'dark' ? value : null; }
  catch { return null; }
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeMeta?.setAttribute('content', theme === 'dark' ? '#091426' : '#f2f4f7');
  for (const button of $$('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  paintMap(canvas, state);
}
for (const button of $$('[data-theme-choice]')) {
  button.addEventListener('click', () => {
    try { localStorage.setItem('ros-theme', button.dataset.themeChoice); } catch { /* sin almacenamiento: solo esta sesión */ }
    applyTheme(button.dataset.themeChoice);
  });
}
systemDark.addEventListener('change', event => { if (!savedTheme()) applyTheme(event.matches ? 'dark' : 'light'); });
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

setupFieldHelp();
new ResizeObserver(() => paintMap(canvas, state)).observe(canvas);
render();




