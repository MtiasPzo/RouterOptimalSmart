import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [dwgPath, screenshotDirectory] = process.argv.slice(2);
if (!dwgPath) throw Error('Indica la ruta al DWG original.');
const playwright = await import(process.env.ROUTEROPTIMAL_PLAYWRIGHT
  ? pathToFileURL(process.env.ROUTEROPTIMAL_PLAYWRIGHT).href : 'playwright');
const base = 'http://127.0.0.1:8014';
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, ROUTEROPTIMAL_PORT: '8014' }, stdio: ['ignore', 'pipe', 'inherit']
});

const browser = await playwright.chromium.launch({
  executablePath: process.env.ROUTEROPTIMAL_CHROME || undefined
}).catch(error => { server.kill(); throw error; });
const page = await browser.newPage({ viewport: { width: 1440, height: 1010 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', msg => { if (process.env.ROUTEROPTIMAL_DEBUG) console.log(msg.type(), msg.text()); });
page.on('response', res => { if (process.env.ROUTEROPTIMAL_DEBUG && res.status() >= 400) console.log(res.status(), res.url()); });
page.on('dialog', dialog => dialog.accept());

const button = (text, target = page) => target.getByRole('button', { name: text, exact: true });
const field = (name, panel = 'element', target = page) => target.locator(`#${panel}-form [name="${name}"]`);
async function checkText(selector, regex) {
  await page.locator(selector).filter({ hasText: regex }).first().waitFor();
}
async function tapPlan(x, y, width, height, target = page, touch = false) {
  const canvas = target.locator('#plan');
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  const scale = Math.min((rect.width - 60) / width, (rect.height - 58) / height);
  const w = width * scale, h = height * scale;
  const cx = rect.x + (rect.width - w) / 2 + x * w;
  const cy = rect.y + (rect.height - h) / 2 + y * h;
  await (touch ? target.touchscreen.tap(cx, cy) : target.mouse.click(cx, cy));
}
async function place(x, y) {
  await button('Ingresar posición del router').click();
  await field('x').fill(String(x));
  await field('y').fill(String(y));
  await button('Aplicar posición').click();
}
async function save(name) {
  await field('positionName', 'save').fill(name);
  await button('Guardar posición').click();
}
async function calibrate(width, height) {
  await tapPlan(.06, .06, width, height);
  await tapPlan(.94, .06, width, height);
  await field('metres', 'calibration').fill('0');
  await button('Confirmar escala').click();
  await checkText('#feedback', /distancia marcada debe estar/);
  await field('metres', 'calibration').fill('9');
  await button('Confirmar escala').click();
  await checkText('#plan-meta', /×/);
}
async function upload(path, expected) {
  await button('Importar plano').click();
  await page.locator('#file').setInputFiles(path);
  try { await checkText('#import-status', expected); }
  catch (error) {
    console.error(await page.locator('#import-status').textContent(), await page.locator('#feedback').textContent(), errors);
    throw error;
  }
  assert.equal(await page.locator('button[data-mode=router]').isDisabled(), true);
}

try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* wait for local HTTP server */ }
    if (attempt === 15) throw Error('El servidor de prueba no respondió.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await page.goto(base);
  await checkText('#point-summary', /Coloca el router/);
  const helpBubble = page.locator('.field-help-bubble');
  assert.deepEqual(await page.locator('input, select').evaluateAll(fields => fields.filter(control => {
    const help = control.closest('.field-with-help')?.querySelector('.field-help-button');
    return !help || !document.getElementById(help.getAttribute('aria-describedby'))?.textContent;
  }).map(control => control.id)), []);
  const widthHelp = button('Ayuda sobre Ancho (metros)');
  await widthHelp.hover();
  await helpBubble.filter({ hasText: '8 metros' }).waitFor();
  await page.mouse.move(4, 4);
  await helpBubble.waitFor({ state: 'hidden' });
  await field('width', 'dimensions').focus();
  await page.keyboard.press('Tab');
  assert.ok(await widthHelp.evaluate(el => el === document.activeElement));
  await helpBubble.waitFor();
  await page.keyboard.press('Escape');
  await helpBubble.waitFor({ state: 'hidden' });
  await button('Ayuda sobre Intensidad de la señal').hover();
  await helpBubble.filter({ hasText: '−50 dBm es más fuerte que −70 dBm' }).waitFor();

  await page.locator('#example').selectOption('blank');
  await field('width', 'dimensions').fill('10');
  await field('height', 'dimensions').fill('8');
  await button('Aplicar medidas').click();
  await checkText('#plan-meta', /10 × 8 m/);

  await button('Dibujar muro').click();
  await tapPlan(.5, .1, 10, 8);
  await tapPlan(.5, .9, 10, 8);
  await field('material').selectOption('ladrillo');
  await field('thickness').fill('-5');
  await button('Guardar muro').click();
  await checkText('#feedback', /grosor en centímetros debe estar/);
  await field('thickness').fill('15');
  await button('Guardar muro').click();
  await checkText('#editor-note', /1 muro/);
  await button('Seleccionar').click();
  await tapPlan(.5, .45, 10, 8);
  await field('loss24').fill('7');
  await button('Guardar muro').click();

  await button('Marcar punto').click();
  await tapPlan(.9, .5, 10, 8);
  await field('pointName').fill('Oficina');
  await button('Guardar punto').click();
  await place(1, 4);
  await checkText('#point-results', /Oficina/);
  await checkText('#point-results summary', /1 muro/);
  await page.locator('#point-results summary').click();
  await checkText('#point-results', /10,5 dB/);
  await save('Oeste');
  await place(8, 4);
  await save('Este');
  await checkText('#comparison .result-summary', /Este deja su punto más débil con más señal/);
  const previous = await page.locator('#point-results td').last().innerText();
  await button('5 GHz').click();
  assert.notEqual(await page.locator('#point-results td').last().innerText(), previous);
  await page.getByText('Ajustes avanzados de señal', { exact: true }).click();
  await button('Ayuda sobre Potencia del router').hover();
  await helpBubble.filter({ hasText: 'EIRP' }).waitFor();
  const beforeChange = await page.locator('#point-results td strong').innerText();
  await field('eirp', 'band').fill('25');
  await button('Aplicar parámetros').click();
  const parse = text => Number(text.replace(',', '.').replace('−', '-'));
  assert.ok(Math.abs(parse(await page.locator('#point-results td strong').innerText()) - parse(beforeChange) - 5) < 0.02);
  await field('width', 'dimensions').fill('2');
  await button('Aplicar medidas').click();
  await checkText('#feedback', /elementos fuera del plano/);
  await page.locator('#element-list').selectOption({ label: 'Muro 1 · Ladrillo' });
  await page.locator('#delete-element').click();
  await checkText('#editor-note', /0 muros/);

  await page.locator('#example').selectOption('two');
  await button('2,4 GHz').click();
  await place(2, 2);
  const otherFloor = page.getByRole('row').filter({ hasText: 'Dormitorio norte' });
  let otherDistance = await otherFloor.locator('td').nth(1).innerText();
  await otherFloor.locator('summary').click();
  await checkText('#point-results', /Losa · 12 dB/);
  await field('floorHeight', 'building').fill('4');
  await button('Aplicar vivienda').click();
  assert.notEqual(await otherFloor.locator('td').nth(1).innerText(), otherDistance);
  await save('Piso de entrada');
  await button('Piso 2').click();
  await place(6, 8);
  await save('Pasillo alto');
  await checkText('#comparison', /Pasillo alto/);
  await checkText('#comparison', /Sala de estudio/);
  if (screenshotDirectory) {
    await page.evaluate(() => { document.querySelector('#feedback').hidden = true; window.scrollTo(0, 0); });
    await page.screenshot({ path: `${screenshotDirectory}/routeroptimal-desktop.png`, fullPage: true });
  }

  await page.locator('#example').selectOption('blank');
  await field('count', 'building').selectOption('2');
  await button('Aplicar vivienda').click();
  await upload(dwgPath, /AC1021 · 5\.596 entidades recuperadas/);
  const colorsRendered = await page.locator('#plan').evaluate(canvas => {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    const colors = new Set();
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3]) colors.add((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]);
      if (colors.size > 20) return true;
    }
    return false;
  });
  assert.ok(colorsRendered, 'La vista original debe pintar geometría en el lienzo.');
  if (screenshotDirectory) {
    await page.locator('.map-card').screenshot({ path: `${screenshotDirectory}/routeroptimal-dwg.png` });
  }
  await button('Recortar vista').click();
  await tapPlan(.14, .097, 2043, 2200);
  await tapPlan(.432, .578, 2043, 2200);
  await calibrate(.292 * 2043, .481 * 2200);
  await page.locator('#element-list').selectOption('new-wall');
  await field('material').selectOption('tabique');
  for (const [name, value] of Object.entries({ thickness: 10, x: 3, y: 1, x2: 3, y2: 7 })) await field(name).fill(String(value));
  await button('Guardar muro').click();
  await place(1, 2);
  await save('Entrada');
  await button('Piso 2').click();
  await upload(fileURLToPath(new URL('../assets/planta-alta.png', import.meta.url)), /planta-alta.png · escala pendiente/);
  await calibrate(544, 962);
  await page.locator('#element-list').selectOption('new-point');
  await field('pointName').fill('Dormitorio');
  await field('x').fill('5');
  await field('y').fill('3');
  await button('Guardar punto').click();
  await checkText('#point-results summary', /losa/);
  await place(4, 3);
  await save('Pasillo');
  await checkText('#comparison .result-summary', /Pasillo deja su punto más débil con más señal/);

  await page.locator('#example').selectOption('cad');
  await checkText('#import-status', /planta-baja.png/);
  await button('Piso 2').click();
  await checkText('#import-status', /planta-alta.png/);

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base);
  const mobileHelp = button('Ayuda sobre Colorear por señal', mobile);
  const mobileBubble = mobile.locator('.field-help-bubble');
  await mobileHelp.tap();
  await mobileBubble.filter({ hasText: 'tonos amarillos' }).waitFor();
  const bounds = await mobileBubble.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
  assert.ok(await mobile.locator('#heat').isChecked());
  await mobileHelp.tap();
  await mobileBubble.waitFor({ state: 'hidden' });

  await tapPlan(.25, .32, 9, 14, mobile, true);
  await mobile.locator('#point-results').getByRole('row').filter({ hasText: 'Escritorio' }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 375);
  if (screenshotDirectory) {
    await mobile.evaluate(() => window.scrollTo(0, 0));
    await mobile.screenshot({ path: `${screenshotDirectory}/routeroptimal-mobile.png`, fullPage: true });
  }
  await mobile.setViewportSize({ width: 812, height: 375 });
  await tapPlan(.75, .64, 9, 14, mobile, true);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 812);
  assert.deepEqual(errors, []);
  console.log('Navegador verificado: ayudas con mouse, teclado y pantalla táctil, dibujo, edición, bandas, DWG, escala y comparación.');
} finally {
  await browser.close();
  server.kill();
  if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
}



