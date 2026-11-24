import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import npmLibraries from 'vite-drupal-npm-libraries';

/**
 * Builds the Vite config from Drupal *.libraries.yml and *.component.yml
 * files, so assets only have to be defined once.
 *
 * Every asset of a library or Single Directory Component that drupal/vite
 * manages is picked up:
 * - files under node_modules/ are copied by vite-drupal-npm-libraries;
 * - any other file (JS, SCSS, CSS...) becomes a build entry.
 *
 * Options for an npm file go on the asset itself, under `vite:`:
 *
 *   js:
 *     ../../../../node_modules/powerbi-client/dist/powerbi.min.js: { vite: { global: true } }
 *     ../../../../node_modules/filesize/dist/filesize.js: { vite: { namespace: filesize } }
 *     ../../../../node_modules/leaflet/dist/leaflet.js: { vite: { global: true, copy: [dist/images/*] } }
 *
 * `copy` lists other files of the package a script loads at runtime; files a
 * copied stylesheet references with url() or @import are copied without it.
 *
 * What is managed mirrors drupal/vite, minus overrides in settings.php (not
 * visible here):
 * - libraries: .info.yml `vite: true`, `vite.enabled` or
 *   `vite.enableInAllLibraries`, then the library's `vite: true|false` or
 *   `vite.enabled`;
 * - components: .info.yml `vite: true`, `vite.enabled` or
 *   `vite.enableInAllComponents`, for all of the extension's components. A
 *   component can't switch it on or off itself: core's SDC schema rejects
 *   `vite:` in `libraryOverrides`, and with assertions on (e.g. in DDEV)
 *   every page then fails with InvalidComponentException. Their
 *   assets are core's auto-discovered <name>.css / <name>.js, unless
 *   `libraryOverrides` replaces the `css` or `js` list (paths relative to the
 *   component directory).
 *
 * Themes' `ckeditor5-stylesheets` (in .info.yml, not a library) are build
 * entries too, when the theme is managed: the same `vite` settings in its
 * .info.yml as for its libraries, or `vite.ckeditor5Stylesheets` for them
 * alone.
 *
 * Contrib libraries that load a third-party library from /libraries/<package>/
 * (where Composer or a manual download would put it) are covered too, managed
 * or not: a file there that the npm package of that name has, at the same
 * path, is copied like a node_modules/ asset. A Drupal module then has to
 * point the library at the copy (see the README).
 *
 * Returns plugins, so use it as `plugins: [drupalLibraries()]`.
 */
export default function drupalLibraries({
  root = process.cwd(),
  dirs = extensionDirs(root),
} = {}) {
  const { inputs, packages, sources } = discover(root, dirs);

  return [
    {
      name: 'drupal-libraries',

      config: () => ({ build: { rollupOptions: { input: inputs } } }),

      configResolved(config) {
        const npmFiles = Object.values(packages).reduce((count, p) => count + p.files.length, 0);
        config.logger.info(`drupal-libraries: ${inputs.length} entries and ${npmFiles} npm files from `
          + `${sources.libraries} libraries.yml and ${sources.components} component.yml files`);
      },

      // Re-read the definitions when they change (restarting reloads this config).
      configureServer(server) {
        const restart = (file) => {
          if (/\.(libraries|info|component)\.yml$/.test(file)) {
            server.config.logger.info(`drupal-libraries: ${path.relative(root, file)} changed, restarting`);
            server.restart();
          }
        };
        server.watcher.on('change', restart).on('add', restart).on('unlink', restart);
      },
    },
    npmLibraries(packages),
  ];
}

const skipDirs = new Set(['node_modules', 'vendor', 'tests']);

// Finds files ending in `suffix` below `dir`.
function findFiles(dir, suffix, found = []) {
  if (!fs.existsSync(dir)) {
    return found;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
      findFiles(path.join(dir, entry.name), suffix, found);
    }
    else if (entry.isFile() && entry.name.endsWith(suffix)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/**
 * The directories Drupal finds extensions in, relative to `root`: web/modules,
 * web/themes and web/profiles, and each site's own (web/sites/<site>/modules
 * and /themes, including sites/all).
 *
 * @returns {string[]}
 */
export function extensionDirs(root = process.cwd()) {
  const sites = path.resolve(root, 'web/sites');
  const siteDirs = fs.existsSync(sites)
    ? fs.readdirSync(sites, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => ['modules', 'themes'].map((type) => `web/sites/${entry.name}/${type}`))
      .filter((dir) => fs.existsSync(path.resolve(root, dir)))
    : [];
  return ['web/modules', 'web/themes', 'web/profiles', ...siteDirs];
}

/**
 * Finds every module, theme and profile below `dirs`, by its .info.yml.
 *
 * Several sites can each have an extension of the same machine name, so they
 * are keyed by directory. `site` is the <site> of web/sites/<site>/ ('all'
 * for sites/all), or null for web/modules, web/themes and web/profiles. Two
 * of the same name in the same place stop the build, as Drupal can only use
 * one of them.
 *
 * @returns {Map<string, {name: string, dir: string, site: string|null, info: object}>}
 *   Keyed by directory, relative to `root`.
 */
export function findExtensions(root = process.cwd(), dirs = extensionDirs(root)) {
  const extensions = new Map();
  const seen = new Map();
  for (const infoFile of dirs.flatMap((dir) => findFiles(path.resolve(root, dir), '.info.yml'))) {
    const dir = path.dirname(infoFile);
    const key = path.relative(root, dir).split(path.sep).join('/');
    const name = path.basename(infoFile, '.info.yml');
    const site = /^web\/sites\/([^/]+)\//.exec(`${key}/`)?.[1] ?? null;
    const scope = `${site}\0${name}`;
    if (seen.has(scope)) {
      throw new Error(`drupal-libraries: two extensions named ${name}${site ? ` in web/sites/${site}` : ''}: `
        + `${seen.get(scope)} and ${key}.`);
    }
    seen.set(scope, key);
    extensions.set(key, { name, dir, site, info: readYaml(infoFile) });
  }
  return extensions;
}

/**
 * Finds the extension a machine name means to a site, as Drupal does: the
 * site's own (web/sites/<site>/) first, then web/modules, web/themes and
 * web/profiles, then sites/all.
 *
 * @param {Map} extensions
 *   From findExtensions().
 * @param {string} name
 *   The machine name.
 * @param {string|null} site
 *   The site, or null for none (web/modules etc., then sites/all).
 *
 * @returns {{name: string, dir: string, site: string|null, info: object}|undefined}
 */
export function lookupExtension(extensions, name, site = null) {
  const candidates = [...extensions.values()].filter((extension) => extension.name === name);
  return [site !== 'all' ? site : undefined, null, 'all']
    .map((scope) => candidates.find((extension) => extension.site === scope))
    .find(Boolean);
}

const readYaml = (file) => (fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) ?? {} : {});

// Mirrors drupal/vite's AssetLibrary::shouldBeManagedByVite(), minus settings.php.
function isManaged(library, info, typeSetting) {
  let enabled = false;
  const extension = info.vite;
  if (typeof extension === 'boolean') {
    enabled = extension;
  }
  else if (extension && typeof extension === 'object') {
    if (typeof extension.enabled === 'boolean') {
      enabled = extension.enabled;
    }
    if (typeof extension[typeSetting] === 'boolean') {
      enabled = extension[typeSetting];
    }
  }
  if (typeof library.vite === 'boolean') {
    enabled = library.vite;
  }
  else if (typeof library.vite?.enabled === 'boolean') {
    enabled = library.vite.enabled;
  }
  return enabled;
}

// Mirrors drupal/vite's Vite::shouldAssetBeManagedByVite().
function isManagedAsset(assetPath, options) {
  return !assetPath.startsWith('/')
    && !assetPath.startsWith('http')
    && !assetPath.startsWith('@vite')
    && options?.type !== 'external'
    && options?.vite !== false
    && options?.vite?.enabled !== false;
}

// For a /libraries/<package>/<file> asset whose npm package has that file,
// the path to it in node_modules/, relative to the extension; otherwise null.
function librariesPath(root, extensionDir, assetPath) {
  const match = /^\/libraries\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(assetPath);
  const file = match && path.join(root, 'node_modules', match[1], match[2]);
  if (!file || !fs.existsSync(file)) {
    return null;
  }
  return path.relative(extensionDir, file).split(path.sep).join('/');
}

// Yields [path, options] for every JS and CSS asset of a library.
function* assets(library) {
  yield* Object.entries(library.js ?? {});
  for (const group of Object.values(library.css ?? {})) {
    yield* Object.entries(group ?? {});
  }
}

// A component's library as core builds it (ComponentPluginManager::
// libraryFromDefinition()): auto-discovered <name>.css / <name>.js, with
// each `css` / `js` list in libraryOverrides replacing the discovered one.
function componentLibrary(file) {
  const dir = path.dirname(file);
  const name = path.basename(file, '.component.yml');
  const library = {};
  if (fs.existsSync(path.join(dir, `${name}.css`))) {
    library.css = { component: { [`${name}.css`]: {} } };
  }
  if (fs.existsSync(path.join(dir, `${name}.js`))) {
    library.js = { [`${name}.js`]: {} };
  }
  return { ...library, ...(readYaml(file).libraryOverrides ?? {}) };
}

function discover(root, dirs) {
  const inputs = new Set();
  const packages = {};
  const sources = { libraries: 0, components: 0 };

  const add = (where, baseDir, assetPath, options, version) => {
    if (!isManagedAsset(assetPath, options)) {
      return;
    }
    where = `${where}: ${assetPath}`;
    const absolute = path.resolve(baseDir, assetPath);
    const relative = path.relative(root, absolute).split(path.sep).join('/');

    if (!relative.startsWith('node_modules/')) {
      if (!fs.existsSync(absolute)) {
        throw new Error(`drupal-libraries: ${where} does not exist.`);
      }
      inputs.add(relative);
      return;
    }

    // node_modules/<name>/<file> or node_modules/@scope/<name>/<file>.
    const parts = relative.slice('node_modules/'.length).split('/');
    const name = parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
    const packageFile = parts.slice(name.split('/').length).join('/');
    if (packageFile.includes('node_modules/')) {
      throw new Error(`drupal-libraries: ${where} is a nested dependency; install it at the top level.`);
    }

    const { global, namespace, copy } = typeof options?.vite === 'object' ? options.vite : {};
    packages[name] ??= { files: [] };
    // A library's `version:` names the package's copies, for a package whose
    // own version is wrong (e.g. installed from a git tag).
    if (version !== undefined) {
      if (packages[name].version !== undefined && packages[name].version !== String(version)) {
        throw new Error(`drupal-libraries: ${where} gives ${name} version ${version}, another library ${packages[name].version}.`);
      }
      packages[name].version = String(version);
    }
    // Extra files to copy are per package, from any of its assets.
    if (copy) {
      packages[name].copy = [...new Set([...(packages[name].copy ?? []), ...[copy].flat()])];
    }
    const existing = packages[name].files.find((f) => f.path === packageFile);
    if (!existing) {
      packages[name].files.push({ path: packageFile, global, namespace });
    }
    else if (existing.global !== global || existing.namespace !== namespace) {
      throw new Error(`drupal-libraries: ${where} is used again with different vite options.`);
    }
  };

  // Every extension, found by its .info.yml (it may have components but no
  // libraries.yml).
  for (const infoFile of dirs.flatMap((dir) => findFiles(path.resolve(root, dir), '.info.yml'))) {
    const extensionDir = path.dirname(infoFile);
    const extension = path.basename(infoFile, '.info.yml');
    const info = readYaml(infoFile);

    const librariesFile = path.join(extensionDir, `${extension}.libraries.yml`);
    if (fs.existsSync(librariesFile)) {
      sources.libraries++;
      for (const [libraryId, library] of Object.entries(readYaml(librariesFile))) {
        if (!library || typeof library !== 'object') {
          continue;
        }
        const managed = isManaged(library, info, 'enableInAllLibraries');
        for (const [assetPath, options] of assets(library)) {
          const npmPath = librariesPath(root, extensionDir, assetPath);
          if (npmPath) {
            add(`${extension}/${libraryId}`, extensionDir, npmPath, options);
          }
          else if (managed) {
            add(`${extension}/${libraryId}`, extensionDir, assetPath, options, library.version);
          }
        }
      }
    }

    // A theme's stylesheets for inside CKEditor 5 (core adds them to the
    // ckeditor5/internal.drupal.ckeditor5.stylesheets library, which the
    // drupal/vite patch for #3447335 processes). Paths relative to the theme;
    // external and root-relative ones are left alone.
    const ckeditorStylesheets = info.type === 'theme' && info['ckeditor5-stylesheets'];
    // `vite.ckeditor5Stylesheets` switches them on or off like a library's `vite:`.
    const stylesheetsLibrary = { vite: info.vite?.ckeditor5Stylesheets };
    if (Array.isArray(ckeditorStylesheets) && isManaged(stylesheetsLibrary, info, 'enableInAllLibraries')) {
      for (const stylesheet of ckeditorStylesheets) {
        if (typeof stylesheet === 'string' && !/^(\/|[a-z]+:)/i.test(stylesheet)) {
          add(`${extension} ckeditor5-stylesheets`, extensionDir, stylesheet, {});
        }
      }
    }

    for (const componentFile of findFiles(path.join(extensionDir, 'components'), '.component.yml')) {
      sources.components++;
      const library = componentLibrary(componentFile);
      if (isManaged(library, info, 'enableInAllComponents')) {
        const component = `${extension}:${path.basename(componentFile, '.component.yml')}`;
        for (const [assetPath, options] of assets(library)) {
          add(component, path.dirname(componentFile), assetPath, options);
        }
      }
    }
  }

  return { inputs: [...inputs].sort(), packages, sources };
}
