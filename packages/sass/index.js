import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionDirs, findExtensions, lookupExtension, webPath } from '@vite-plugin-drupal/libraries';

/**
 * Compiles existing SCSS with Vite the way the Sass CLI did, so it does not
 * need converting to the module system or to Vite's URL rules.
 *
 * - Relative @import/@use are resolved by Sass itself. Vite's own importer
 *   rewrites url() in imported partials to be relative to each partial; the
 *   Sass CLI leaves them as written, i.e. relative to the compiled CSS. Here
 *   they stay as written and Vite resolves them from the entry file, which
 *   matches the CLI as long as the entry and the old CSS output directory
 *   are at the same depth (e.g. scss/style.scss -> css/style.css).
 * - `loadPaths` replaces `--load-path` (node_modules by default), and the
 *   webpack-style `~package/...` prefix is accepted.
 * - Preloaded partials: variables, mixins and functions usable in every SCSS
 *   file without importing them, like the old build's prepended data. Each
 *   module, theme and profile lists its own in its .info.yml:
 *
 *     vite:
 *       preload:
 *         functions: [bootstrap/scss/functions]
 *         variables: [scss/_variables.scss]
 *         mixins: [scss/_mixins.scss]
 *
 *   (paths relative to the extension, or to the load paths; a plain list is
 *   the same as `mixins`). A file gets one theme's preloads: each theme's
 *   variables file imports the level above itself (a site theme's imports the
 *   base theme's, which imports the Bootstrap theme's: Bootstrap's functions,
 *   variables and mixins),
 *   so the build doesn't follow `base theme:` beyond finding the nearest
 *   theme that has `preload` (a sub-theme without any uses its base theme's).
 *   A theme's files get their theme's; files in modules and profiles get a
 *   theme's and then their own: for one in a site's own directory
 *   (sites/<site>/modules in the web root, `webRoot`), that site's theme
 *   from `siteThemes`; for any other, `moduleTheme`. `siteThemes` keys are site directory names or glob
 *   patterns for them (`*`, `?`, `{a,b}`), e.g.
 *   `{ 'site-a.*': 'site_a_theme', '*.example.com': 'my_theme' }`: an exact
 *   name wins, otherwise the first matching pattern in the order written. A
 *   site nothing matches uses `moduleTheme`, with a warning. In order:
 *     1. functions, the theme's then the module's;
 *     2. variables, the module's then the theme's, so the module's values
 *        come before the theme's `!default`s;
 *     3. mixins, the theme's then the module's, so they can use every
 *        variable.
 *   `vite: { preload: false }` turns preloading off for an extension's files.
 *   `preload` here takes the same shape, as a level above every theme (and
 *   the only one for files outside any extension).
 *   They are @imported, in that order, into one module per extension, which
 *   each file loads with `@use ... as *` (unlike a prepended @import, this
 *   also works in files that start with @use). Preloaded files should hold no
 *   CSS rules: those would be output into every compiled file.
 * - Deprecation warnings that legacy code triggers on every build are
 *   silenced; pass `silenceDeprecations: []` to see them again.
 */
export default function drupalSass({
  loadPaths = ['node_modules'],
  preload = {},
  moduleTheme = null,
  siteThemes = {},
  webRoot = 'web',
  dirs = null,
  silenceDeprecations = ['import', 'global-builtin', 'color-functions', 'slash-div', 'if-function', 'abs-percent'],
} = {}) {
  return {
    name: 'drupal-sass',

    config(config) {
      const root = path.resolve(config.root ?? process.cwd());
      const resolvedLoadPaths = loadPaths.map((loadPath) => path.resolve(root, loadPath));

      // Finds `url` the way Sass looks up a load: partials, extensions and
      // index files.
      const find = (base) => {
        const dir = path.dirname(base);
        const name = path.basename(base);
        const candidates = path.extname(name)
          ? [base, path.join(dir, `_${name}`)]
          : ['.scss', '.sass', '.css'].flatMap((ext) => [
            path.join(dir, `${name}${ext}`),
            path.join(dir, `_${name}${ext}`),
            path.join(base, `index${ext}`),
            path.join(base, `_index${ext}`),
          ]);
        return candidates.some((candidate) => fs.existsSync(candidate));
      };

      const preloads = createPreloads({
        root, webRoot, dirs: dirs ?? extensionDirs(root, webRoot), preload, moduleTheme, siteThemes, find, resolvedLoadPaths,
      });

      return {
        css: {
          preprocessorOptions: {
            scss: {
              loadPaths: resolvedLoadPaths,
              additionalData: (source, filename) => {
                const url = preloads.urlFor(filename);
                return url ? `@use '${url}' as *;\n${source}` : source;
              },
              silenceDeprecations,
              // Taking the base importer slot (otherwise Vite's) makes Sass
              // resolve relative loads itself, without URL rebasing.
              importer: { findFileUrl: () => null },
              importers: [
                preloads.importer,
                // Bare loads (`package/file`, `~package/file`): runs before
                // Vite's importer, and files found here are loaded by Sass
                // directly, so their url()s aren't rebased either.
                {
                  findFileUrl(url) {
                    const bare = url.replace(/^~/, '');
                    if (bare.includes(':')) {
                      return null;
                    }
                    for (const loadPath of resolvedLoadPaths) {
                      const base = path.join(loadPath, bare);
                      if (find(base)) {
                        return pathToFileURL(base);
                      }
                    }
                    return null;
                  },
                },
              ],
            },
          },
        },
      };
    },
  };
}

const phases = ['functions', 'variables', 'mixins'];
const scheme = 'drupal-sass-preload:';
// The module for files outside any extension.
const noExtension = '-';

// Works out, from the .info.yml files, what each extension's files preload.
// Extensions are keyed by directory, as several sites can each have one of
// the same name; names (moduleTheme, siteThemes, `base theme:`) are resolved
// for the site the compiled file is in, as Drupal would for that site.
function createPreloads({ root, webRoot, dirs, preload, moduleTheme, siteThemes, find, resolvedLoadPaths }) {
  const extensions = findExtensions(root, dirs, webRoot);
  const isTheme = (extension) => extension?.info.type === 'theme';
  if (moduleTheme && !isTheme(lookupExtension(extensions, moduleTheme))) {
    throw new Error(`drupalSass: moduleTheme '${moduleTheme}' is not a theme`);
  }
  for (const [site, theme] of Object.entries(siteThemes)) {
    if (![...extensions.values()].some((extension) => extension.name === theme && isTheme(extension))) {
      throw new Error(`drupalSass: siteThemes['${site}'] '${theme}' is not a theme`);
    }
  }

  // siteThemes keys as [regex, theme], in the order written.
  const sitePatterns = Object.entries(siteThemes).map(([pattern, theme]) => [globToRegExp(pattern), theme]);

  // The theme name whose preloads a module's (or profile's) files get: its
  // site's theme for one in sites/<site>/, moduleTheme for any other.
  const warned = new Set();
  const themeFor = ({ site }) => {
    if (site === null || site === 'all') {
      return moduleTheme;
    }
    const theme = Object.hasOwn(siteThemes, site) ? siteThemes[site]
      : sitePatterns.find(([regex]) => regex.test(site))?.[1];
    if (theme) {
      return theme;
    }
    if (!warned.has(site)) {
      warned.add(site);
      console.warn(`drupalSass: no siteThemes entry matches ${webPath(webRoot, `sites/${site}`)}; its modules use moduleTheme${moduleTheme ? ` (${moduleTheme})` : ''}.`);
    }
    return moduleTheme;
  };
  // Deepest first, so a module inside another extension (or a profile) wins.
  const byDir = [...extensions].sort(([, a], [, b]) => b.dir.length - a.dir.length);

  // One level's preloads, as {functions, variables, mixins} lists of URLs.
  const level = (label, list, dir) => {
    const lists = Array.isArray(list) ? { mixins: list } : (list ?? {});
    return Object.fromEntries(phases.map((phase) => [phase, (lists[phase] ?? []).map((file) => {
      // As file: URLs, since a relative URL in the preload module would
      // resolve against its own (non-file) URL.
      const found = [dir, ...resolvedLoadPaths].map((base) => path.resolve(base, file)).find(find);
      if (found) {
        return pathToFileURL(found).href;
      }
      throw new Error(`drupalSass: preload file '${file}' of ${label} not found`);
    })]));
  };
  const configLevel = level('the Vite config', preload, root);

  // The theme whose preloads apply for a theme name, resolved for a site:
  // the nearest one, from that theme up its `base theme:` chain, whose
  // .info.yml has `preload` (its files import the levels above themselves).
  // Undefined when none has, or the nearest says `preload: false`.
  const preloadTheme = (name, site, seen = []) => {
    const extension = lookupExtension(extensions, name, site);
    if (!isTheme(extension)) {
      // A base theme outside these directories (e.g. core's) has no preloads.
      if (seen.length) {
        return undefined;
      }
      throw new Error(`drupalSass: theme '${name}' not found${site ? ` for ${webPath(webRoot, `sites/${site}`)}` : ''}`);
    }
    const preloads = extension.info.vite?.preload;
    if (preloads !== undefined) {
      return preloads === false ? undefined : extension;
    }
    const base = extension.info['base theme'];
    return base && !seen.includes(name) ? preloadTheme(base, site, [...seen, name]) : undefined;
  };

  // Preload module contents, keyed by extension directory.
  const contents = new Map();
  const contentsFor = (key) => {
    if (!contents.has(key)) {
      const extension = extensions.get(key);
      // A theme's file: one theme's preloads. A module's (or profile's) file:
      // its theme's, then its own.
      const themeName = !extension ? null
        : extension.info.type === 'theme' ? extension.name : themeFor(extension);
      const theme = themeName ? preloadTheme(themeName, extension.site) : undefined;
      const own = extension && extension.info.type !== 'theme' ? [extension] : [];
      const levels = [
        configLevel,
        ...[theme, ...own].filter(Boolean).map((e) => level(e.name, e.info.vite?.preload, e.dir)),
      ];
      const urls = [
        ...levels.flatMap((l) => l.functions),
        ...levels.toReversed().flatMap((l) => l.variables),
        ...levels.flatMap((l) => l.mixins),
      ];
      contents.set(key, urls.map((url) => `@import ${JSON.stringify(url)};\n`).join(''));
    }
    return contents.get(key);
  };

  return {
    // The preload module URL for a file being compiled, or null for none.
    urlFor(filename) {
      const file = path.resolve(filename);
      const [key, extension] = byDir.find(([, e]) => file.startsWith(e.dir + path.sep)) ?? [noExtension];
      if (extension?.info.vite?.preload === false || !contentsFor(key)) {
        return null;
      }
      return `${scheme}${encodeURIComponent(key)}`;
    },
    importer: {
      canonicalize: (url) => (url.startsWith(scheme) && contents.has(decodeURIComponent(url.slice(scheme.length)))
        ? new URL(url) : null),
      load: (url) => ({ contents: contentsFor(decodeURIComponent(new URL(url).pathname)), syntax: 'scss' }),
    },
  };
}

// A glob for a single path segment (`*`, `?`, `{a,b}`) as an anchored regex.
function globToRegExp(glob) {
  let regex = '';
  for (const part of glob.split(/(\*|\?|\{[^}]*\})/)) {
    if (part === '*') {
      regex += '[^/]*';
    }
    else if (part === '?') {
      regex += '[^/]';
    }
    else if (/^\{[^}]*\}$/.test(part)) {
      regex += `(?:${part.slice(1, -1).split(',').map((alt) => alt.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
    }
    else {
      regex += part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${regex}$`);
}
