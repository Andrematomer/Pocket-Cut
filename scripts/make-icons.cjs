// Renders public/icons/icon.svg into the PNG sizes the manifest and iOS need. Run: node scripts/make-icons.cjs
// Needs Playwright (any Chromium). The PNGs are committed, so this is only for changing the icon.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const inner = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '');
const BG = '#12161a';

// kind: 'rounded' (as the SVG), 'square' (full bleed, iOS rounds it itself), 'maskable' (art shrunk into the safe zone)
function page(size, kind) {
  const art =
    kind === 'rounded'
      ? svg
      : kind === 'square'
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/>${inner.replace(/<rect width="512" height="512"[^>]*\/>/, '')}</svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/><g transform="translate(97.3 97.3) scale(0.62)">${inner.replace(/<rect width="512" height="512"[^>]*\/>/, '')}</g></svg>`;
  return `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${art.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`;
}

(async () => {
  const browser = await chromium.launch();
  const jobs = [
    ['icon-192.png', 192, 'rounded'],
    ['icon-512.png', 512, 'rounded'],
    ['icon-maskable-512.png', 512, 'maskable'],
    ['apple-touch-icon.png', 180, 'square'],
  ];
  for (const [file, size, kind] of jobs) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(page(size, kind));
    await p.screenshot({ path: path.join(dir, file), omitBackground: kind === 'rounded' });
    await p.close();
  }
  await browser.close();
})();
