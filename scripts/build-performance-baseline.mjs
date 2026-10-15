// Measure HEAD with the same dependencies/config without changing the working tree.
import { build, loadConfigFromFile } from 'vite';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve('frontend');
const paths = ['CRM', 'Inventory', 'Orders', 'Ecommerce'].map(n => `frontend/src/pages/${n}.tsx`);
const originals = new Map(paths.map(p => [resolve(p).replaceAll('\\', '/'), execFileSync('git', ['show', `HEAD:${p}`], {encoding:'utf8'})]));
const loaded = await loadConfigFromFile({ command:'build', mode:'production' }, resolve(root,'vite.config.ts'));
await build({ ...loaded.config, configFile:false, root,
    plugins:[{ name:'performance-baseline', enforce:'pre', load(id) { return originals.get(id.replaceAll('\\','/')) ?? null; } },...loaded.config.plugins],
    build:{outDir:resolve('output/performance-2026-10-15/baseline-dist'),emptyOutDir:true} });
