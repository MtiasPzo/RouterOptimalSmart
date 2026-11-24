export function drawingSvg(library, dwg) {
  const database = library.convert(dwg);
  if (!database.entities.length) throw new Error('El DWG no contiene entidades que el conversor pueda mostrar.');
  let svg = library.dwg_to_svg(database);
  const bounds = svg.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  if (bounds?.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0 ||
      !/<(?:path|line|circle|polyline|polygon|ellipse|text|use)\b/.test(svg)) {
    throw new Error('El conversor no obtuvo una vista 2D válida.');
  }
  const scale = 2200 / Math.max(bounds[2], bounds[3]);
  const width = Math.max(1, Math.round(bounds[2] * scale));
  const height = Math.max(1, Math.round(bounds[3] * scale));
  svg = svg.replace('width="100%" height="100%"', `width="${width}" height="${height}"`)
    .replaceAll('rgb(0,0,0)', 'rgb(176,187,198)')
    .replaceAll('rgb(0,0,255)', 'rgb(124,155,248)')
    .replaceAll('rgb(255,0,0)', 'rgb(247,138,118)')
    .replaceAll('rgb(0,255,0)', 'rgb(153,214,160)');
  return { svg, database, width, height };
}
