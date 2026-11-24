import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'vite';
import { parse } from 'yaml';
import { extensionDirs, findExtensions } from 'vite-plugin-drupal-libraries';

/**
 * Builds Drupal CKEditor 5 plugins with Vite instead of webpack.
 *
 * Applies to sources following Drupal's layout,
 * <extension>/js/ckeditor5_plugins/<pluginName>/src/*.js, written exactly as
 * for the webpack/DLL build:
 *
 * - `import { Plugin } from 'ckeditor5/src/core'` becomes a lookup in the
 *   CKEditor 5 DLL that Drupal core already loads
 *   (`CKEditor5.dll('./src/core.js')`), so the plugin shares core's CKEditor
 *   instead of bundling its own;
 * - `import icon from './icon.svg'` gives the SVG markup (webpack's raw-loader);
 * - the default export of src/index.js is registered as
 *   `CKEditor5.<pluginName>`, where Drupal looks for `<pluginName>.<Class>`
 *   from the *.ckeditor5.yml.
 *
 * Which plugins to build comes from each module's *.ckeditor5.yml, written as
 * for webpack: a definition whose `drupal.library` is a library of the module
 * loading js/build/<pluginName>.js, for its `<pluginName>.<Class>` plugins
 * with a source in this layout. A Drupal module then has to load this build
 * in place of js/build/<pluginName>.js (see the README). CSS the plugin
 * imports is loaded with it.
 */
export default function ckeditor5Plugins({
  root = process.cwd(),
  webRoot = 'web',
  dirs = extensionDirs(root, webRoot),
} = {}) {
  const pluginSource = /\/js\/ckeditor5_plugins\/([^/]+)\/src\//;
  const ckeditorImport = /^ckeditor5\/src\/([a-z0-9-]+)(?:\.js)?$/;

  // `{ a, b as c }` for a destructuring assignment.
  const pattern = (specifiers) => `{ ${specifiers
    .map((s) => (s.imported.name === s.local.name ? s.local.name : `${s.imported.name}: ${s.local.name}`))
    .join(', ')} }`;

  return {
    name: 'ckeditor5-plugins',
    enforce: 'pre',

    config: () => ({ build: { rollupOptions: { input: findEntries(root, dirs, webRoot) } } }),

    // Re-read the definitions when they change.
    configureServer(server) {
      const restart = (file) => {
        if (file.endsWith('.ckeditor5.yml')) {
          server.config.logger.info(`ckeditor5-plugins: ${path.relative(root, file)} changed, restarting`);
          server.restart();
        }
      };
      server.watcher.on('change', restart).on('add', restart).on('unlink', restart);
    },

    async resolveId(source, importer, options) {
      // Provided by core's DLL at runtime. transform() removes these imports,
      // so only the dev server's dependency scan gets here.
      if (ckeditorImport.test(source)) {
        return { id: source, external: true };
      }
      if (!importer || !pluginSource.test(importer) || !source.endsWith('.svg')) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && { ...resolved, id: `${resolved.id}?raw` };
    },

    transform(code, id) {
      const match = id.split('?')[0].match(pluginSource);
      if (!match || !/\.[cm]?js$/.test(id.split('?')[0])) {
        return null;
      }
      const [, pluginName] = match;
      const replacements = [];
      let defaultExport = null;

      for (const node of parseAst(code).body) {
        const dll = ckeditorImport.exec(node.source?.value ?? '');
        if (node.type === 'ImportDeclaration' && dll) {
          const lookup = `globalThis.CKEditor5.dll(${JSON.stringify(`./src/${dll[1]}.js`)})`;
          const named = node.specifiers.filter((s) => s.type === 'ImportSpecifier');
          const statements = [];
          if (named.length) {
            statements.push(`const ${pattern(named)} = ${lookup};`);
          }
          for (const s of node.specifiers) {
            if (s.type === 'ImportNamespaceSpecifier') {
              statements.push(`const ${s.local.name} = ${lookup};`);
            }
            else if (s.type === 'ImportDefaultSpecifier') {
              statements.push(`const ${s.local.name} = ${lookup}.default;`);
            }
          }
          replacements.push([node.start, node.end, statements.join(' ')]);
        }
        else if (dll) {
          this.error(`${id}: re-exporting from ${node.source.value} is not supported.`);
        }
        else if (node.type === 'ExportDefaultDeclaration' && /\/src\/index\.[cm]?js$/.test(id.split('?')[0])) {
          defaultExport = node;
        }
      }

      if (defaultExport) {
        const { declaration } = defaultExport;
        let suffix = '';
        if (declaration.id) {
          // export default class Foo {} -> keep the declaration.
          replacements.push([defaultExport.start, declaration.start, '']);
          suffix += `\nconst __ckeditor5Plugins = ${declaration.id.name};`;
        }
        else {
          replacements.push([defaultExport.start, declaration.start, 'const __ckeditor5Plugins = ']);
        }
        suffix += '\nexport default __ckeditor5Plugins;\n'
          + `(globalThis.CKEditor5 ??= {})[${JSON.stringify(pluginName)}] = __ckeditor5Plugins;\n`;
        replacements.push([code.length, code.length, suffix]);
      }

      if (!replacements.length) {
        return null;
      }
      let output = code;
      for (const [start, end, text] of replacements.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
        output = output.slice(0, start) + text + output.slice(end);
      }
      return { code: output, map: null };
    },
  };
}

/**
 * Finds the plugin sources to build, from every module's *.ckeditor5.yml.
 *
 * The Drupal module that loads the build has to find the same sources.
 */
function findEntries(root, dirs, webRoot) {
  const entries = new Set();
  for (const { name, dir, info } of findExtensions(root, dirs, webRoot).values()) {
    const file = path.join(dir, `${name}.ckeditor5.yml`);
    if (!['module', 'profile'].includes(info.type) || !fs.existsSync(file)) {
      continue;
    }
    const librariesFile = path.join(dir, `${name}.libraries.yml`);
    const libraries = fs.existsSync(librariesFile) ? parse(fs.readFileSync(librariesFile, 'utf8')) ?? {} : {};
    for (const definition of Object.values(parse(fs.readFileSync(file, 'utf8')) ?? {})) {
      const library = definition?.drupal?.library;
      if (typeof library !== 'string' || !library.startsWith(`${name}/`)) {
        continue;
      }
      const js = libraries[library.slice(name.length + 1)]?.js ?? {};
      for (const plugin of definition.ckeditor5?.plugins ?? []) {
        const pluginName = String(plugin).split('.')[0];
        const source = path.join(dir, 'js/ckeditor5_plugins', pluginName, 'src/index.js');
        if (Object.hasOwn(js, `js/build/${pluginName}.js`) && fs.existsSync(source)) {
          entries.add(path.relative(root, source).split(path.sep).join('/'));
        }
      }
    }
  }
  return [...entries].sort();
}
