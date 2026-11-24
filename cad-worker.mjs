import { drawingSvg } from './cad.mjs';

self.addEventListener('message', async ({ data: buffer }) => {
  try {
    const { library, types } = await import('./cad-runtime/dist/libredwg-web.js')
      .then(async ({ LibreDwg, Dwg_File_Type }) => ({
        library: await LibreDwg.create(),
        types: Dwg_File_Type
      }))
      .catch(() => { throw new Error('El conversor DWG no está disponible. Ejecuta npm install o importa el plano exportado como PNG.'); });
    const data = library.dwg_read_data(buffer, types.DWG);
    if (!data) throw new Error('El conversor no pudo leer el contenido de este DWG.');
    try {
      const version = library.dwg_get_version_type(data).hdr;
      const { svg, database } = drawingSvg(library, data);
      self.postMessage({ svg, version, entities: database.entities.length });
    } finally {
      library.dwg_free(data);
    }
  } catch (error) {
    self.postMessage({ error: error.message || 'No se pudo convertir el DWG. Puedes importar una exportación PNG.' });
  }
});


