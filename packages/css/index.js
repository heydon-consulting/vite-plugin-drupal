import fs from 'node:fs';
import path from 'node:path';
import { extensionDirs, findExtensions, lookupExtension, webPath } from '@vite-plugin-drupal/libraries';

/**
 * Drupal-aware CSS compilation: load paths for @import, and stylesheets
 * preloaded into every CSS file from the modules' and themes' .info.yml.
 *
 * - `loadPaths`: a bare
 *   `@import 'my_theme/css/forms.css'` is looked up in each load path in
 *   turn (node_modules first by default), and the webpack-style
 *   `~package/...` prefix is accepted. node_modules is Vite's own lookup;
 *   other load paths become aliases for their top-level directories, so the
 *   same names also work in JS imports. A name already found in an earlier
 *   load path keeps that one.
 * - Preloaded stylesheets: Tailwind theme, utilities and custom variants
 *   usable in every CSS file without referencing them. Each module, theme
 *   and profile lists its own in its .info.yml:
 *
 *     vite:
 *       preload: [css/style.css]
 *
 *   (paths relative to the extension, or to the load paths, e.g.
 *   `tailwindcss`). They are added to each compiled file as `@reference`,
 *   so they output no CSS of their own; this needs tailwindcss() after this
 *   plugin. A file is never given a reference to itself, so a theme can
 *   preload its main stylesheet.
 *   A file gets one theme's preloads: the nearest theme, from its own up
 *   the `base theme:` chain, that has `preload` (a theme's main stylesheet
 *   imports or references the level above itself). A theme's files get
 *   their theme's; files in modules and profiles get a theme's and then
 *   their own: for one in a site's own directory (sites/<site>/modules in
 *   the web root, `webRoot`), that site's theme from `siteThemes`; for any
 *   other, `moduleTheme`.
 *   `siteThemes` keys are site directory names or glob patterns for them
 *   (`*`, `?`, `{a,b}`): an exact name wins, otherwise the first matching
 *   pattern in the order written. A site nothing matches uses
 *   `moduleTheme`, with a warning. `preload` here comes before every
 *   theme's (and is the only one for files outside any extension).
 *   `vite: { preload: false }` turns preloading off for an extension's files.
 *   Preloads go into each CSS file Vite compiles: library entries, component
 *   CSS and CSS imported from JS, but not files those @import (they are
 *   compiled as part of the importing file) or CSS in node_modules.
 */
export default function drupalCss({
  loadPaths = ['node_modules'],
  preload = [],
  moduleTheme = null,
  siteThemes = {},
  webRoot = 'web',
  dirs = null,
} = {}) {
  let preloads;

  return {
    name: 'drupal-css',
    // Before tailwindcss(), which compiles the @reference rules.
    enforce: 'pre',

    config(config) {
      const root = path.resolve(config.root ?? process.cwd());
      const resolvedLoadPaths = loadPaths.map((loadPath) => path.resolve(root, loadPath));
      preloads = createPreloads({
        root, webRoot, dirs: dirs ?? extensionDirs(root, webRoot), preload, moduleTheme, siteThemes, resolvedLoadPaths,
      });
      return { resolve: { alias: loadPathAliases(root, resolvedLoadPaths) } };
    },

    transform: {
      filter: {
        id: {
          include: /\.css(?:\?|$)/,
          exclude: [/\/node_modules\//, /\/\.vite\//, /[?&](?:raw|url|worker|sharedworker)\b/],
        },
      },
      handler(code, id) {
        const references = preloads.for(id.split('?')[0]);
        if (!references.length) {
          return null;
        }
        // On the first line, so the file's own line numbers don't move.
        const prefix = references.map((file) => `@reference ${JSON.stringify(file)}; `).join('');
        return { code: prefix + code, map: null };
      },
    },
  };
}

// Aliases for load paths: each top-level directory of a load path other than
// node_modules (which Vite already looks in), unless an earlier load path has
// a directory of the same name; then any other `~name/...` as a path in
// node_modules. Vite applies only the first matching alias, so each takes an
// optional `~`, and they resolve to absolute paths (a bare name left by an
// alias isn't looked up again).
function loadPathAliases(root, resolvedLoadPaths) {
  const aliases = [];
  const nodeModules = path.join(root, 'node_modules');
  const seen = new Set();
  for (const loadPath of resolvedLoadPaths) {
    if (!fs.existsSync(loadPath)) {
      throw new Error(`drupalCss: load path '${path.relative(root, loadPath)}' does not exist`);
    }
    for (const entry of fs.readdirSync(loadPath, { withFileTypes: true })) {
      const name = entry.name;
      if (!entry.isDirectory() || name.startsWith('.') || seen.has(name)) {
        continue;
      }
      seen.add(name);
      if (loadPath !== nodeModules) {
        const escaped = name.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
        aliases.push({ find: new RegExp(`^~?${escaped}(?=/)`), replacement: path.join(loadPath, name) });
      }
    }
  }
  return [...aliases, { find: /^~(?=[^/])/, replacement: `${nodeModules}/` }];
}

// The module for files outside any extension.
const noExtension = '-';

// Works out, from the .info.yml files, what each extension's files preload.
// Extensions are keyed by directory, as several sites can each have one of
// the same name; names (moduleTheme, siteThemes, `base theme:`) are resolved
// for the site the compiled file is in, as Drupal would for that site.
function createPreloads({ root, webRoot, dirs, preload, moduleTheme, siteThemes, resolvedLoadPaths }) {
  const extensions = findExtensions(root, dirs, webRoot);
  const isTheme = (extension) => extension?.info.type === 'theme';
  if (moduleTheme && !isTheme(lookupExtension(extensions, moduleTheme))) {
    throw new Error(`drupalCss: moduleTheme '${moduleTheme}' is not a theme`);
  }
  for (const [site, theme] of Object.entries(siteThemes)) {
    if (![...extensions.values()].some((extension) => extension.name === theme && isTheme(extension))) {
      throw new Error(`drupalCss: siteThemes['${site}'] '${theme}' is not a theme`);
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
      console.warn(`drupalCss: no siteThemes entry matches ${webPath(webRoot, `sites/${site}`)}; its modules use moduleTheme${moduleTheme ? ` (${moduleTheme})` : ''}.`);
    }
    return moduleTheme;
  };
  // Deepest first, so a module inside another extension (or a profile) wins.
  const byDir = [...extensions].sort(([, a], [, b]) => b.dir.length - a.dir.length);

  // One level's preloads, as absolute paths.
  const level = (label, list, dir) => {
    if (list !== undefined && !Array.isArray(list)) {
      throw new Error(`drupalCss: preload of ${label} must be a list of stylesheets`);
    }
    return (list ?? []).map((file) => {
      const found = [dir, ...resolvedLoadPaths].map((base) => findStylesheet(path.resolve(base, file))).find(Boolean);
      if (found) {
        return found;
      }
      throw new Error(`drupalCss: preload file '${file}' of ${label} not found`);
    });
  };
  const configLevel = level('the Vite config', preload, root);

  // The theme whose preloads apply for a theme name, resolved for a site:
  // the nearest one, from that theme up its `base theme:` chain, whose
  // .info.yml has `preload`. Undefined when none has, or the nearest says
  // `preload: false`.
  const preloadTheme = (name, site, seen = []) => {
    const extension = lookupExtension(extensions, name, site);
    if (!isTheme(extension)) {
      // A base theme outside these directories (e.g. core's) has no preloads.
      if (seen.length) {
        return undefined;
      }
      throw new Error(`drupalCss: theme '${name}' not found${site ? ` for ${webPath(webRoot, `sites/${site}`)}` : ''}`);
    }
    const preloads = extension.info.vite?.preload;
    if (preloads !== undefined) {
      return preloads === false ? undefined : extension;
    }
    const base = extension.info['base theme'];
    return base && !seen.includes(name) ? preloadTheme(base, site, [...seen, name]) : undefined;
  };

  // Preloads, keyed by extension directory.
  const lists = new Map();
  const listFor = (key) => {
    if (!lists.has(key)) {
      const extension = extensions.get(key);
      // A theme's file: one theme's preloads. A module's (or profile's) file:
      // its theme's, then its own.
      const themeName = !extension ? null
        : extension.info.type === 'theme' ? extension.name : themeFor(extension);
      const theme = themeName ? preloadTheme(themeName, extension.site) : undefined;
      const own = extension && extension.info.type !== 'theme' ? [extension] : [];
      lists.set(key, [...new Set([
        ...configLevel,
        ...[theme, ...own].filter(Boolean).flatMap((e) => level(e.name, e.info.vite?.preload, e.dir)),
      ])]);
    }
    return lists.get(key);
  };

  return {
    // The stylesheets to reference from a file being compiled.
    for(filename) {
      const file = path.resolve(filename);
      const [key, extension] = byDir.find(([, e]) => file.startsWith(e.dir + path.sep)) ?? [noExtension];
      if (extension?.info.vite?.preload === false) {
        return [];
      }
      return listFor(key).filter((preloaded) => preloaded !== file);
    },
  };
}

// The stylesheet a preload path means: the file itself, with .css added, or
// a directory's index.css (e.g. node_modules/tailwindcss for `tailwindcss`).
function findStylesheet(base) {
  for (const candidate of [base, `${base}.css`, path.join(base, 'index.css')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
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
