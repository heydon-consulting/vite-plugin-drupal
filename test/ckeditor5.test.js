import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import ckeditor5Plugins from 'vite-plugin-drupal-ckeditor5';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-drupal-ckeditor5-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

// A module with two CKEditor 5 plugins in Drupal's layout, one of them in a
// library drupal/vite doesn't manage.
function write(file, contents) {
  const target = path.join(root, 'web/modules/custom/my_module', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
write('my_module.info.yml', 'name: My module\ntype: module\n');
write('my_module.ckeditor5.yml', [
  'my_module_vite:',
  '  ckeditor5: { plugins: [viteBuilt.ViteBuilt] }',
  '  drupal: { library: my_module/vite_built }',
  'my_module_webpack:',
  '  ckeditor5: { plugins: [webpackBuilt.WebpackBuilt] }',
  '  drupal: { library: my_module/webpack_built }',
  '',
].join('\n'));
write('my_module.libraries.yml', [
  'vite_built:',
  '  js:',
  '    js/build/viteBuilt.js: {}',
  'webpack_built:',
  '  vite: false',
  '  js:',
  '    js/build/webpackBuilt.js: {}',
  '',
].join('\n'));
write('js/ckeditor5_plugins/viteBuilt/src/index.js', 'export default {};\n');
write('js/ckeditor5_plugins/webpackBuilt/src/index.js', 'export default {};\n');

test('builds plugins in Drupal\'s layout, leaving out libraries with vite: false', () => {
  const plugin = [ckeditor5Plugins({ root })].flat().find((p) => typeof p.config === 'function');
  assert.deepEqual(plugin.config().build.rollupOptions.input, [
    'web/modules/custom/my_module/js/ckeditor5_plugins/viteBuilt/src/index.js',
  ]);
});
