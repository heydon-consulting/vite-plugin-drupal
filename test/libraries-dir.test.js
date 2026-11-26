import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { build } from 'vite';
import drupalLibraries from 'vite-plugin-drupal-libraries';

const projects = [];
after(() => projects.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A project with a contrib module loading /libraries/gallery/ files, the npm
// package `gallery` installed, and another module using a package from
// node_modules/ directly.
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-drupal-'));
  projects.push(root);
  const write = (file, contents = '') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  };
  write('node_modules/gallery/package.json', '{"name":"gallery","version":"2.1.0"}');
  write('node_modules/gallery/dist/gallery.js', 'this.Gallery = 1;');
  write('node_modules/gallery/dist/gallery.css', '.g { background: url(images/arrow.svg); }');
  write('node_modules/gallery/dist/images/arrow.svg', '<svg/>');
  write('node_modules/gallery/src/unused.js', '');
  write('node_modules/dayjs/package.json', '{"name":"dayjs","version":"1.11.0"}');
  write('node_modules/dayjs/dayjs.min.js', 'var dayjs = 1;');
  write('web/modules/contrib/gallery_module/gallery_module.info.yml', 'name: Gallery\ntype: module\n');
  write('web/modules/contrib/gallery_module/gallery_module.libraries.yml', [
    'gallery:',
    '  js:',
    '    /libraries/gallery/dist/gallery.js: {}',
    '  css:',
    '    component:',
    '      /libraries/gallery/dist/gallery.css: {}',
    '',
  ].join('\n'));
  write('web/modules/custom/my_module/my_module.info.yml', 'name: Mine\ntype: module\nvite: true\n');
  write('web/modules/custom/my_module/my_module.libraries.yml',
    'dayjs:\n  js:\n    ../../../../node_modules/dayjs/dayjs.min.js: { vite: { global: true } }\n'
    + 'main:\n  js:\n    js/main.js: {}\n');
  write('web/modules/custom/my_module/js/main.js', 'console.log(1);');
  return root;
}

const run = (root, options) => build({
  root,
  configFile: false,
  logLevel: 'silent',
  plugins: drupalLibraries({ root, ...options }),
  build: { outDir: 'web/dist', emptyOutDir: false, manifest: true },
});

const exists = (root, file) => fs.existsSync(path.join(root, file));

test('without librariesDir, /libraries files are versioned copies in the manifest', async () => {
  const root = project();
  await run(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web/dist/.vite/manifest.json'), 'utf8'));
  assert.equal(manifest['node_modules/gallery/dist/gallery.js'].file, 'gallery@2.1.0/dist/gallery.js');
  assert.ok(exists(root, 'web/dist/gallery@2.1.0/dist/images/arrow.svg'));
  assert.ok(!exists(root, 'web/libraries'));
});

test('with librariesDir, they are copied unchanged to <librariesDir>/<package>/', async () => {
  const root = project();
  await run(root, { librariesDir: 'web/libraries' });

  const lib = (file) => path.join(root, 'web/libraries/gallery', file);
  assert.equal(fs.readFileSync(lib('dist/gallery.js'), 'utf8'), 'this.Gallery = 1;');
  assert.ok(fs.existsSync(lib('dist/gallery.css')));
  // Referenced by the stylesheet.
  assert.ok(fs.existsSync(lib('dist/images/arrow.svg')));
  // Only what's used.
  assert.ok(!fs.existsSync(lib('src/unused.js')));
  assert.deepEqual(JSON.parse(fs.readFileSync(lib('.npm-libraries.json'), 'utf8')), {
    package: 'gallery',
    version: '2.1.0',
    files: ['dist/gallery.css', 'dist/gallery.js', 'dist/images/arrow.svg'],
  });

  // Not in the build output or the manifest; node_modules/ assets still are.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web/dist/.vite/manifest.json'), 'utf8'));
  assert.ok(!Object.keys(manifest).some((src) => src.includes('gallery')));
  assert.equal(manifest['node_modules/dayjs/dayjs.min.js'].file, 'dayjs@1.11.0/dayjs.min.js');
  assert.ok(!exists(root, 'web/dist/gallery@2.1.0'));
});

test('librariesDirExclude packages are versioned copies in the manifest instead', async () => {
  const root = project();
  await run(root, { librariesDir: 'web/libraries' });
  assert.ok(exists(root, 'web/libraries/gallery/.npm-libraries.json'));

  await run(root, { librariesDir: 'web/libraries', librariesDirExclude: ['gallery'] });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web/dist/.vite/manifest.json'), 'utf8'));
  assert.equal(manifest['node_modules/gallery/dist/gallery.js'].file, 'gallery@2.1.0/dist/gallery.js');
  assert.ok(exists(root, 'web/dist/gallery@2.1.0/dist/images/arrow.svg'));
  // The copy an earlier build made is removed.
  assert.ok(!exists(root, 'web/libraries/gallery'));
});

test('a rebuild replaces its own copies and removes unused ones', async () => {
  const root = project();
  await run(root, { librariesDir: 'web/libraries' });
  fs.writeFileSync(path.join(root, 'web/libraries/gallery/dist/stale.js'), '');
  await run(root, { librariesDir: 'web/libraries' });
  assert.ok(!exists(root, 'web/libraries/gallery/dist/stale.js'));

  // The module no longer uses it.
  fs.writeFileSync(path.join(root, 'web/modules/contrib/gallery_module/gallery_module.libraries.yml'), '');
  await run(root, { librariesDir: 'web/libraries' });
  assert.ok(!exists(root, 'web/libraries/gallery'));
});

test('a library installed another way is left alone', async () => {
  const root = project();
  fs.mkdirSync(path.join(root, 'web/libraries/gallery/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web/libraries/gallery/dist/gallery.js'), 'composer copy');
  fs.mkdirSync(path.join(root, 'web/libraries/other'), { recursive: true });
  await run(root, { librariesDir: 'web/libraries' });
  assert.equal(fs.readFileSync(path.join(root, 'web/libraries/gallery/dist/gallery.js'), 'utf8'), 'composer copy');
  assert.ok(!exists(root, 'web/libraries/gallery/.npm-libraries.json'));
  assert.ok(exists(root, 'web/libraries/other'));
});

test('librariesDir can be the build output directory', async () => {
  const root = project();
  await run(root, { librariesDir: 'web/dist' });
  await run(root, { librariesDir: 'web/dist' });
  assert.ok(exists(root, 'web/dist/gallery/dist/gallery.js'));
  assert.ok(exists(root, 'web/dist/dayjs@1.11.0/dayjs.min.js'));
});
