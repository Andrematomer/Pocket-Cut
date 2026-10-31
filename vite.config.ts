import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

/** Writes dist/sw.js: the service worker with the list of every built file to cache for offline use. */
function offlineServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'offline-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const hash = createHash('sha1');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const urls = ['./', ...list.map((f) => './' + f)];
      const template = readFileSync(resolve(import.meta.dirname, 'scripts/sw-template.js'), 'utf8');
      if (template.includes('__VERSION__') === false) throw new Error('sw template has no version placeholder');
      writeFileSync(join(outDir, 'sw.js'), template.replaceAll('__VERSION__', version).replaceAll('__FILES__', JSON.stringify(urls)));
    },
  };
}

// base './' so the build works under https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  plugins: [preact(), offlineServiceWorker()],
  build: { target: 'es2022' },
});
