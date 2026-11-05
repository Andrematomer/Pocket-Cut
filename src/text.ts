/** Renders a piece of text into a transparent picture, so it can be placed like any other picture. */
export const TEXT_COLORS = ['#ffffff', '#f6d04d', '#ff5d5d', '#6ee7a8', '#6db3ff', '#000000'] as const;

export const TEXT_FONTS: { key: string; name: string; css: string; weight: number }[] = [
  { key: 'sans', name: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: 700 },
  { key: 'serif', name: 'Serif', css: 'Georgia, "Times New Roman", Times, serif', weight: 700 },
  { key: 'mono', name: 'Mono', css: 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace', weight: 700 },
  { key: 'impact', name: 'Impact', css: 'Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Black", sans-serif', weight: 400 },
  { key: 'round', name: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", Nunito, system-ui, sans-serif', weight: 800 },
  { key: 'hand', name: 'Handwritten', css: '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Chalkboard SE", cursive', weight: 700 },
];

export async function renderText(text: string, color: string, fontKey = 'sans'): Promise<{ blob: Blob; bitmap: ImageBitmap; width: number; height: number }> {
  const lines = text.split('\n').map((l) => l.trimEnd());
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const f = TEXT_FONTS.find((x) => x.key === fontKey) ?? TEXT_FONTS[0]!;
  const font = `${f.weight} 120px ${f.css}`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const widest = Math.max(40, ...lines.map((l) => probe.measureText(l).width));
  const lineH = 150;
  const pad = 50;
  const width = Math.min(4000, Math.ceil(widest + pad * 2));
  const height = Math.ceil(lines.length * lineH + pad * 2);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const dark = color.toLowerCase() === '#000000';
  lines.forEach((l, i) => {
    const y = pad + lineH * i + lineH / 2;
    // an outline in the opposite shade keeps the text readable on any picture
    g.lineWidth = 14;
    g.strokeStyle = dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
    g.strokeText(l, width / 2, y);
    g.fillStyle = color;
    g.fillText(l, width / 2, y);
  });
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
  const bitmap = await createImageBitmap(blob);
  return { blob, bitmap, width, height };
}
