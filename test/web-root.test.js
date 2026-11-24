import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import drupalLibraries, { extensionDirs, findExtensions, webPath } from 'vite-plugin-drupal-libraries';

const projects = [];
after(() => projects.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A project with Drupal in `webRoot`: a module, and a theme in a site's own
// directory, each with a library Vite manages.
function project(webRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-drupal-'));
  projects.push(root);
  const write = (file, contents) => {
    const target = path.join(root, webPath(webRoot, file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  write('modules/custom/my_module/my_module.info.yml', 'name: My module\ntype: module\nvite: true\n');
  write('modules/custom/my_module/my_module.libraries.yml', 'main:\n  js:\n    js/main.js: {}\n');
  write('modules/custom/my_module/js/main.js', '');
  write('sites/site-a/themes/my_theme/my_theme.info.yml', 'name: My theme\ntype: theme\nvite: true\n');
  write('sites/site-a/themes/my_theme/my_theme.libraries.yml', 'global:\n  css:\n    theme:\n      css/style.css: {}\n');
  write('sites/site-a/themes/my_theme/css/style.css', '');
  return root;
}

// The build entries drupalLibraries() sets, relative to the project.
function inputs(root, options) {
  const [plugin] = drupalLibraries({ root, ...options });
  return plugin.config().build.rollupOptions.input;
}

test('webPath() joins paths in the web root', () => {
  assert.equal(webPath('web', 'modules'), 'web/modules');
  assert.equal(webPath('docroot/', 'modules'), 'docroot/modules');
  assert.equal(webPath('./public/web', 'sites/'), 'public/web/sites/');
  assert.equal(webPath('', 'modules'), 'modules');
  assert.equal(webPath('.', 'modules'), 'modules');
});

for (const [label, webRoot, prefix] of [['web (default)', undefined, 'web/'], ['docroot', 'docroot', 'docroot/'], ['the project root', '', '']]) {
  describe(`with Drupal in ${label}`, () => {
    const root = project(webRoot ?? 'web');

    test('extensionDirs() finds the web root and site directories', () => {
      assert.deepEqual(extensionDirs(root, webRoot), [
        `${prefix}modules`, `${prefix}themes`, `${prefix}profiles`, `${prefix}sites/site-a/themes`,
      ]);
    });

    test('findExtensions() gives each extension its site', () => {
      const extensions = [...findExtensions(root, undefined, webRoot).values()]
        .map(({ name, site }) => ({ name, site }))
        .sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(extensions, [{ name: 'my_module', site: null }, { name: 'my_theme', site: 'site-a' }]);
    });

    test('drupalLibraries() builds the libraries', () => {
      assert.deepEqual(inputs(root, { webRoot }).sort(), [
        `${prefix}modules/custom/my_module/js/main.js`,
        `${prefix}sites/site-a/themes/my_theme/css/style.css`,
      ]);
    });
  });
}
