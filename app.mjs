import { BANDS, MATERIALS, EPSILON, estimate, comparePositions, calibratedDimensions, sameWall } from './model.mjs';
import { newFloor, example } from './examples.mjs';
import { canvasPoint, hitTest, paintMap, signalColor } from './map.mjs';
import { setupFieldHelp } from './field-help.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  building: example('one'), activeFloor: 0, band: '2.4', heat: true,
  mode: 'router', marks: [], selection: null, draft: null, wallStart: null
};
const canvas = $('#plan');
const forms = Object.fromEntries(['building', 'dimensions', 'band', 'calibration', 'element', 'save']
  .map(key => [key, $(`#${key}-form`)]));
const field = (form, name) => forms[form].elements.namedItem(name);
const floor = () => state.building.floors[state.activeFloor];
const ready = item => !item.background || item.background.calibrated;
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

function itemsOnFloor(item, index) {
  const router = state.building.router;
  return [
    ...item.walls.flatMap(w => [w.a, w.b]), ...item.points,
    ...(router?.floor === index ? [router] : []),
    ...state.building.positions.filter(p => p.floor === index)
  ];
}

function setMode(mode) {
  state.mode = mode;
  state.marks = [];
  state.wallStart = null;
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
    wall: state.wallStart ? 'Marca el segundo extremo del muro.' :
      'Marca los dos extremos del muro. Se crea con tabique por defecto; ajústalo en Elementos del plano.',
    point: 'Toca el lugar que quieres evaluar. Puedes cambiar su nombre en Elementos del plano.',
    router: state.building.router ? 'Toca otra posición disponible para mover el router.' :
      'Toca una posición disponible en este piso para colocar el router.',
    calibration: state.marks.length === 2 ? 'Ingresa la distancia real entre las marcas y confirma la escala.' :
      state.marks.length === 1 ? 'Marca el segundo extremo de una distancia conocida.' : 'Marca el primer extremo de una distancia conocida.',
    crop: state.marks.length ? 'Marca la esquina opuesta del recorte.' : 'Marca una esquina de la vista que quieres usar.'
  };
  $('#map-hint').textContent = hints[state.mode];
  canvas.dataset.mode = state.mode;
  $('#calibration-form').hidden = state.mode !== 'calibration';
  paintMap(canvas, state);
}

function renderControls() {
  const item = floor();
  const background = item.background;
  const band = BANDS[state.band];
  const bands = state.building.bands[state.band];
  write('building', { count: state.building.count, floorHeight: state.building.floorHeight });
  field('building', 'floorHeight').disabled = state.building.count === 1 && field('building', 'count').value === '1';
  write('dimensions', { width: item.width, height: item.height });
  write('band', bands);
  for (const button of $$('[data-floor]')) {
    const index = Number(button.dataset.floor);
    button.hidden = index >= state.building.count;
    button.setAttribute('aria-pressed', String(state.activeFloor === index));
  }
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

function referenceDetails(result, p, router) {
  const angle = result.angle === null ? 'sin dirección horizontal' : `${f(result.angle)}°`;
  const walls = result.walls.map(w => `<span class="detail-line">${MATERIALS[w.material].label}, ${floorName(w.floor)} · ${f(w.loss)} dB</span>`).join('');
  return `<details><summary>${result.walls.length} ${result.walls.length === 1 ? "muro" : "muros"}${result.differentFloor ? ' y losa' : ''}</summary>
    <span class="detail-line">Δx ${f(p.x - router.x)} m · Δy ${f(p.y - router.y)} m</span>
    <span class="detail-line">Δz ${f((p.floor - router.floor) * state.building.floorHeight)} m · θ ${angle}</span>
    <span class="detail-line">Espacio libre a 1 m · ${f(result.fspl)} dB</span>
    <span class="detail-line">Señal a 1 m · ${f(result.reference)} dBm</span>
    <span class="detail-line">Distancia · ${f(result.distanceLoss)} dB</span>
    <span class="detail-line">Muros · ${f(result.wallsLoss)} dB</span>
    <span class="detail-line">Losa · ${f(result.slab)} dB</span>${walls}</details>`;
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
      if (!ready(building.floors[p.floor])) return `<tr>${name}<td colspan="3">Escala pendiente</td></tr>`;
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
  const usable = targets.length && [...targets, ...saved].every(item => ready(building.floors[item.floor]));
  const results = usable ? comparePositions(saved, targets, building, band) : saved.map(position => ({ position }));
  const leader = results[0];
  const ties = usable ? results.filter(result => Math.abs(result.minimum - leader.minimum) < EPSILON) : [];
  let summary = 'Marca puntos de interés y confirma la escala en los pisos usados.';
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

function render() { renderControls(); renderEditor(); renderPlan(); renderResults(); }

for (const [key, material] of Object.entries(MATERIALS)) field('element', 'material').add(option(key, material.label));
field('element', 'material').add(option('', 'Elegir material'), 0);
field('element', 'material').addEventListener('change', () => {
  const material = MATERIALS[field('element', 'material').value];
  write('element', { loss24: material?.losses['2.4'], loss5: material?.losses['5'] });
});

field('building', 'count').addEventListener('change', () => {
  field('building', 'floorHeight').disabled = field('building', 'count').value === '1';
});
listenForm('building', () => {
  const count = Number(field('building', 'count').value);
  const building = state.building;
  const floorHeight = count === 2 ? readNumber('building', 'floorHeight', 'La altura', 0.01) : building.floorHeight;
  if (count === 1 && building.router?.floor === 1) throw new Error('Mueve el router al piso 1 o quítalo antes de usar un solo piso.');
  building.count = count;
  building.floorHeight = floorHeight;
  if (state.activeFloor >= count) selectFloor(0);
  else render();
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

$('#floor-tabs').addEventListener('click', event => { if (event.target.matches('[data-floor]')) selectFloor(Number(event.target.dataset.floor)); });
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
  renderEditor();
  renderPlan();
});
$('#heat').addEventListener('change', event => { state.heat = event.target.checked; renderPlan(); pulse(); });

$('#route-draw').addEventListener('click', () => {
  const item = floor();
  if (item.background && !window.confirm('¿Quitar el fondo importado de este piso? Se conservan las dimensiones y los elementos guardados.')) return;
  targetMarks.delete(item);
  Object.assign(item, { route: 'draw', background: null });
  setMode('select');
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
  renderPlan();
}

function placeRouter(p) {
  state.building.router = { ...p, floor: state.activeFloor };
  state.selection = { kind: 'router', id: 'router' };
  render();
  pulse();
}

canvas.addEventListener('click', event => {
  const hit = canvasPoint(canvas, event, floor());
  if (!hit) { announce('Marca una ubicación dentro del borde del plano.', true); return; }
  if (state.mode === 'crop') { markCrop(hit); return; }
  if (state.mode === 'calibration') { markCalibration(hit); return; }
  if (!ready(floor())) return;
  const p = planCoordinate(hit);
  if (state.mode === 'router') { placeRouter(p); return; }
  if (state.mode === 'wall') {
    if (!state.wallStart) { state.wallStart = p; renderPlan(); return; }
    if (Math.hypot(p.x - state.wallStart.x, p.y - state.wallStart.y) < EPSILON) {
      announce('El muro necesita dos extremos distintos.', true);
      return;
    }
    if (floor().walls.some(wall => sameWall(wall, { a: state.wallStart, b: p }))) {
      announce('Ya existe un muro con esos dos extremos.', true);
      state.wallStart = null;
      renderPlan();
      return;
    }
    const id = `wall-${++nextId}`;
    floor().walls.push({ id, a: state.wallStart, b: p, material: 'tabique',
      thickness: 0.1, losses: { ...MATERIALS.tabique.losses } });
    state.wallStart = null;
    state.selection = { kind: 'wall', id };
    render();
    pulse();
    return;
  }
  if (state.mode === 'point') {
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
    renderPlan();
    return;
  }
  if (floor().walls.some(wall => wall.id === id)) { useSelection('wall', id); return; }
  if (floor().points.some(point => point.id === id)) { useSelection('point', id); return; }
  state.selection = null;
  setMode('select');
  renderEditor();
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
  if (kind === 'router') { placeRouter(a); announce('Posición del router actualizada.'); return; }
  if (wall) {
    const b = { x: readNumber('element', 'x2', 'La distancia final desde la izquierda', 0, item.width),
      y: readNumber('element', 'y2', 'La distancia final desde arriba', 0, item.height) };
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPSILON) throw new Error('El muro necesita dos extremos distintos.');
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
$('#delete-element').addEventListener('click', () => {
  const { kind, id } = state.selection;
  if (kind === 'router') state.building.router = null;
  if (kind === 'wall') floor().walls = floor().walls.filter(w => w.id !== id);
  if (kind === 'point') floor().points = floor().points.filter(p => p.id !== id);
  state.selection = null;
  render();
  announce('Elemento borrado.');
});

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
  return building.router || building.positions.length || building.floors.some(item => item.background || item.walls.length || item.points.length);
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
  themeMeta?.setAttribute('content', theme === 'dark' ? '#0c1117' : '#f2f4f7');
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




