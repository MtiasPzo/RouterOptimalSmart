import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import { drawingSvg } from '../cad.mjs';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('Uso: node tools/inspect-dwg.mjs <archivo.dwg> [salida.svg]');
  process.exitCode = 2;
} else {
  const wasm = fileURLToPath(new URL('../node_modules/@mlightcad/libredwg-web/wasm/', import.meta.url)).replaceAll('\\', '/');
  const library = await LibreDwg.create(wasm);
  const file = await readFile(input);
  const drawing = library.dwg_read_data(Uint8Array.from(file).buffer, Dwg_File_Type.DWG);
  if (!drawing) throw new Error('No fue posible recuperar el dibujo.');
  try {
    const version = library.dwg_get_version_type(drawing);
    const { database, svg } = drawingSvg(library, drawing);
    const totals = Object.create(null);
    for (const { type } of database.entities) totals[type] = (totals[type] ?? 0) + 1;
    console.log(JSON.stringify({ version, entities: database.entities.length, totals, units: database.header.INSUNITS }, null, 2));
    if (output) await writeFile(output, svg, 'utf8');
  } finally {
    library.dwg_free(drawing);
  }
}
