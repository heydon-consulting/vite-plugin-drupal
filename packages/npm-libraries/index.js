import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'vite';

/**
 * Copies prebuilt files out of npm packages into the Vite build output and
 * registers them in the Vite manifest.
 *
 * Drupal libraries can then reference the files by their node_modules source
 * path with `vite: true`, and the drupal/vite module rewrites them to the
 * copied dist file (or to the dev server while `vite` is running).
 *
 * Usually configured by vite-plugin-drupal-libraries from *.libraries.yml.
 *
 * Options, keyed by package name:
 *   files:  Paths inside the package to copy, either strings or
 *           `{ path, global, namespace }` to set the options below per file
 *           (they override the package-level ones).
 *   global: The file is a UMD/IIFE script that expects to run as a classic
 *           script. drupal/vite always loads rewritten JS as type="module",
 *           where top-level `this` is undefined, so the file is wrapped to run
 *           with `this` bound to the global object.
 *           Set it to a name (or list of names) instead of `true` when the
 *           script declares its globals as top-level variables
 *           (`var Foo = ...`); those are local inside a module, so they are
 *           assigned to `globalThis` explicitly.
 *   namespace: Expose the file's exports as `globalThis[namespace]`, so other
 *           Drupal libraries can use it without importing it.
 *           - ES module: copied as-is, with its named exports also assigned
 *             to the global.
 *           - CommonJS (no `export` statements): wrapped with a `module` /
 *             `exports` stub and `module.exports` assigned to the global.
 *             Only self-contained files work; `require()` is not supported.
 *   copy:   Other files of the package to copy as they are, as patterns
 *           relative to the package (`*` within a directory, `**` across
 *           them), e.g. `['dist/images/*']`: files a script loads itself at
 *           runtime. Package-level only (a per-file `copy` is added to it).
 *   version: The version in the copies' <package>@<version>/ directory,
 *           instead of the one in the package's package.json (e.g. 0.0.0 in
 *           a package installed from a git tag).
 *
 *   libraries: Paths inside the package to copy unchanged to
 *           <librariesDir>/<package>/, where Composer or a download would put
 *           the library, for a contrib module that loads it from
 *           /libraries/<package>/. Needs the `librariesDir` setting. These
 *           aren't in the manifest: Drupal loads them like any /libraries
 *           files.
 *
 * Copies keep their path inside the package, under <package>@<version>/.
 * Files a copied CSS file references with url() or @import are copied too
 * (and imported CSS is scanned in turn), so its relative URLs keep working.
 * External, absolute and data: URLs are left alone; a reference to a file
 * the package doesn't have is reported as a warning.
 *
 * Settings (the second argument):
 *   librariesDir: Drupal's libraries directory, relative to the Vite root
 *           (e.g. 'web/libraries'), for packages' `libraries` files. A
 *           package directory there that this plugin didn't create (no
 *           .npm-libraries.json in it), e.g. one installed with Composer, is
 *           left alone, with a warning. Directories it created for packages
 *           no longer used are removed.
 *
 * Example:
 *   npmLibraries({
 *     'powerbi-client': { files: ['dist/powerbi.min.js'], global: true },
 *     filesize: { files: ['lib/filesize.js'], global: true },
 *     'countup.js': { files: ['dist/countUp.min.js'], namespace: 'countUp' },
 *     toc: { files: ['dist/toc.min.js'], global: true, version: '0.3.2' },
 *     dayjs: { files: [{ path: 'dayjs.min.js', global: true }, { path: 'plugin/utc.js', global: true }] },
 *     leaflet: { files: ['dist/leaflet.js', 'dist/leaflet.css'], global: true, copy: ['dist/images/*'] },
 *     photoswipe: { libraries: ['dist/photoswipe.css', 'dist/umd/photoswipe.umd.min.js'] },
 *   }, { librariesDir: 'web/libraries' })
 */
export default function npmLibraries(packages = {}, { librariesDir } = {}) {
  let config;
  // Map of source path (relative to the Vite root) => file definition.
  const files = new Map();
  // Package name => { version, dir, files } for copies to librariesDir.
  const librariesCopies = new Map();

  const manifestName = () => (typeof config.build.manifest === 'string'
    ? config.build.manifest
    : '.vite/manifest.json');

  const wrap = (code, globals = []) => {
    const assignments = globals.map((name) => `globalThis[${JSON.stringify(name)}] = ${name};\n`).join('');
    return `(function () {\n${code}\n${assignments}}).call(globalThis);\n`;
  };

  // Assigns a module's exports to `globalThis[namespace]`.
  const expose = (code, namespace, src) => {
    const body = parseAst(code).body;
    const isEsm = body.some((node) => node.type.startsWith('Export') || node.type === 'ImportDeclaration');
    return isEsm ? exposeEsm(code, body, namespace, src) : exposeCommonJs(code, namespace, src);
  };

  const exposeCommonJs = (code, namespace, src) => {
    if (/\brequire\s*\(/.test(code)) {
      throw new Error(`npm-libraries: ${src} calls require(); bundle it from a Vite entry instead.`);
    }
    return `{\nconst module = { exports: {} };\n(function (module, exports) {\n${code}\n}).call(module.exports, module, module.exports);\n`
      + `globalThis[${JSON.stringify(namespace)}] = module.exports;\n}\n`;
  };

  // Appends `globalThis[namespace] = { ...named exports }` to an ES module.
  const exposeEsm = (code, body, namespace, src) => {
    const entries = [];
    for (const node of body) {
      if (node.type === 'ExportNamedDeclaration' && !node.source) {
        const declared = node.declaration?.declarations?.map((d) => d.id.name)
          ?? (node.declaration?.id ? [node.declaration.id.name] : []);
        declared.forEach((name) => entries.push(`${name}: ${name}`));
        node.specifiers.forEach((s) => entries.push(`${JSON.stringify(s.exported.name)}: ${s.local.name}`));
      }
      else if (node.type.startsWith('Export')) {
        throw new Error(`npm-libraries: ${src} uses ${node.type}, which namespace does not support.`);
      }
    }
    return `${code}\nglobalThis[${JSON.stringify(namespace)}] = Object.freeze({ ${entries.join(', ')} });\n`;
  };

  const prepare = (code, file, src) => {
    if (file.global) {
      return wrap(code, file.globals);
    }
    return file.namespace ? expose(code, file.namespace, src) : code;
  };

  // Some packages reference source maps they don't ship; drop those comments
  // so browsers and the dev server don't go looking for them.
  const stripMissingSourceMaps = (code, absolute) => code.replace(
    /(?:\/\/|\/\*)# sourceMappingURL=(\S+?)(?:\s*\*\/)?[ \t]*$/gm,
    (comment, url) => (url.startsWith('data:') || fs.existsSync(path.join(path.dirname(absolute), url)) ? comment : ''),
  );

  // Returns the file contents as served/copied: text files are processed,
  // anything else (fonts, images) is passed through untouched.
  const read = (src, file) => {
    if (!/\.(m?js|css)$/.test(src)) {
      return fs.readFileSync(file.absolute);
    }
    const code = stripMissingSourceMaps(fs.readFileSync(file.absolute, 'utf8'), file.absolute);
    return prepare(code, file, src);
  };

  return {
    name: 'npm-libraries',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      // Copies go in <outDir>/<package>@<version>/, next to Vite's own output.
      const reserved = [config.build.assetsDir, '.vite'];
      for (const [name, options] of Object.entries(packages)) {
        if (reserved.includes(name.split('/')[0])) {
          throw new Error(`npm-libraries: package "${name}" clashes with the "${name.split('/')[0]}" output directory.`);
        }
        const packageDir = path.join(config.root, 'node_modules', name);
        const packageJson = path.join(packageDir, 'package.json');
        if (!fs.existsSync(packageJson)) {
          throw new Error(`npm-libraries: package "${name}" is not installed (run npm install ${name}).`);
        }
        const version = options.version ?? JSON.parse(fs.readFileSync(packageJson, 'utf8')).version;
        const srcOf = (file) => path.relative(config.root, path.join(packageDir, file)).split(path.sep).join('/');
        const add = (file, fileOptions = {}) => {
          const absolute = path.join(packageDir, file);
          const src = srcOf(file);
          const { global, namespace } = fileOptions;
          files.set(src, {
            absolute,
            global: Boolean(global) && file.endsWith('.js'),
            globals: typeof global === 'string' || Array.isArray(global) ? [global].flat() : [],
            namespace: file.endsWith('.js') ? namespace : undefined,
            fileName: `${name}@${version}/${file}`,
          });
        };

        const copy = new Set([options.copy ?? []].flat());
        const css = [];
        for (const entry of options.files ?? []) {
          const { path: file, ...fileOptions } = typeof entry === 'string' ? { path: entry } : entry;
          if (!fs.existsSync(path.join(packageDir, file))) {
            throw new Error(`npm-libraries: ${name}/${file} does not exist.`);
          }
          add(file, {
            global: fileOptions.global ?? options.global,
            namespace: fileOptions.namespace ?? options.namespace,
          });
          [fileOptions.copy ?? []].flat().forEach((pattern) => copy.add(pattern));
          if (file.endsWith('.css')) {
            css.push(file);
          }
        }

        // Files a script loads at runtime.
        for (const pattern of copy) {
          const matches = matchFiles(packageDir, pattern);
          if (!matches.length) {
            throw new Error(`npm-libraries: copy pattern "${pattern}" matches no files in ${name}.`);
          }
          // A file also listed keeps its own options. Only libraries files:
          // `copy` goes with those (below).
          if (options.files?.length || !options.libraries?.length) {
            matches.filter((file) => !files.has(srcOf(file))).forEach((file) => add(file));
          }
        }

        // Files the CSS references, and the CSS those import.
        cssClosure(packageDir, css, config.logger, name)
          .filter((file) => !files.has(srcOf(file)))
          .forEach((file) => add(file));

        // Unchanged copies for /libraries/<package>/.
        if (options.libraries?.length) {
          if (!librariesDir) {
            throw new Error(`npm-libraries: package "${name}" has libraries files, but librariesDir isn't set.`);
          }
          const listed = [...new Set(options.libraries)];
          for (const file of listed) {
            if (!fs.existsSync(path.join(packageDir, file))) {
              throw new Error(`npm-libraries: ${name}/${file} does not exist.`);
            }
          }
          const all = new Set(listed);
          // `copy` files go with them when the package has no build copies.
          if (!options.files?.length) {
            for (const pattern of copy) {
              matchFiles(packageDir, pattern).forEach((file) => all.add(file));
            }
          }
          cssClosure(packageDir, listed.filter((file) => file.endsWith('.css')), config.logger, name)
            .forEach((file) => all.add(file));
          librariesCopies.set(name, { version, dir: packageDir, files: [...all].sort() });
        }
      }
    },

    // The output directory is shared (build.emptyOutDir is off), so remove
    // only what this build owns: Vite's manifest and assets directories, every
    // version of the configured packages, and the package copies the last
    // build made (from its manifest), so packages no longer used go too.
    buildStart() {
      if (librariesDir) {
        copyToLibraries(path.resolve(config.root, librariesDir), librariesCopies, config.logger);
      }
      if (config.command !== 'build') {
        return;
      }
      const outDir = path.resolve(config.root, config.build.outDir);
      const owned = new Set([path.join(outDir, '.vite'), path.join(outDir, config.build.assetsDir)]);
      for (const name of Object.keys(packages)) {
        const parent = path.join(outDir, path.dirname(name));
        const prefix = `${path.basename(name)}@`;
        if (fs.existsSync(parent)) {
          fs.readdirSync(parent)
            .filter((entry) => entry.startsWith(prefix))
            .forEach((entry) => owned.add(path.join(parent, entry)));
        }
      }
      const manifestPath = path.join(outDir, manifestName());
      if (fs.existsSync(manifestPath)) {
        for (const chunk of Object.values(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))) {
          // <package>@<version>/... or @scope/<package>@<version>/...
          const copy = String(chunk?.src ?? '').startsWith('node_modules/')
            && /^((?:@[^/]+\/)?[^/@]+@[^/]+)\//.exec(String(chunk.file ?? ''));
          if (copy) {
            owned.add(path.join(outDir, copy[1]));
          }
        }
      }
      for (const dir of owned) {
        fs.rmSync(dir, { recursive: true, force: true });
        // Drop an @scope directory the removal left empty.
        const parent = path.dirname(dir);
        if (parent !== outDir && path.basename(parent).startsWith('@') && fs.existsSync(parent) && !fs.readdirSync(parent).length) {
          fs.rmdirSync(parent);
        }
      }
    },

    // Dev server: serve the same processed contents when the file is
    // requested from node_modules. Loading it here (rather than transforming)
    // also stops Vite from reading source maps the package doesn't ship.
    load(id) {
      if (config.command !== 'serve') {
        return null;
      }
      const src = path.relative(config.root, id.split('?')[0]).split(path.sep).join('/');
      const file = files.get(src);
      return file && /\.(m?js|css)$/.test(src) ? { code: read(src, file), map: null } : null;
    },

    generateBundle() {
      for (const [src, file] of files) {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: read(src, file) });
      }
    },

    // Vite writes the manifest itself; add the copied files to it afterwards
    // so drupal/vite can resolve them like any other chunk.
    writeBundle(outputOptions) {
      if (!config.build.manifest || files.size === 0) {
        return;
      }
      const manifestPath = path.join(outputOptions.dir, manifestName());
      const manifest = fs.existsSync(manifestPath)
        ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        : {};
      for (const [src, file] of files) {
        manifest[src] = { file: file.fileName, src, isEntry: true };
      }
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    },
  };
}

// The marker in a librariesDir package directory this plugin created.
const MARKER = '.npm-libraries.json';

// Copies packages' `libraries` files to <librariesDir>/<package>/, replacing
// only directories this plugin created (with a MARKER), and removes the ones
// it created for packages no longer used.
function copyToLibraries(librariesDir, copies, logger) {
  const owned = new Set();
  if (fs.existsSync(librariesDir)) {
    for (const entry of fs.readdirSync(librariesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const names = entry.name.startsWith('@')
        ? fs.readdirSync(path.join(librariesDir, entry.name)).map((child) => `${entry.name}/${child}`)
        : [entry.name];
      names.filter((name) => fs.existsSync(path.join(librariesDir, name, MARKER))).forEach((name) => owned.add(name));
    }
  }

  for (const name of owned) {
    if (!copies.has(name)) {
      removeDir(librariesDir, name);
    }
  }
  for (const [name, { version, dir, files }] of copies) {
    const target = path.join(librariesDir, name);
    if (fs.existsSync(target) && !owned.has(name)) {
      logger.warn(`npm-libraries: ${path.relative(process.cwd(), target) || target} wasn't made by this build `
        + `(installed another way?), so it's left alone. Remove it to use the npm package ${name}@${version}.`);
      continue;
    }
    removeDir(librariesDir, name);
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
      fs.copyFileSync(path.join(dir, file), path.join(target, file));
    }
    fs.writeFileSync(path.join(target, MARKER), `${JSON.stringify({ package: name, version, files }, null, 2)}\n`);
  }
}

// Removes <librariesDir>/<name>, and an @scope directory it leaves empty.
function removeDir(librariesDir, name) {
  fs.rmSync(path.join(librariesDir, name), { recursive: true, force: true });
  const scope = path.dirname(path.join(librariesDir, name));
  if (scope !== librariesDir && fs.existsSync(scope) && !fs.readdirSync(scope).length) {
    fs.rmdirSync(scope);
  }
}

// The files stylesheets reference with url() and @import, and those the
// imported stylesheets reference in turn, relative to the package.
function cssClosure(packageDir, stylesheets, logger, name) {
  const found = new Set();
  const css = [...stylesheets];
  const scanned = new Set();
  while (css.length) {
    const file = css.pop();
    if (scanned.has(file)) {
      continue;
    }
    scanned.add(file);
    for (const reference of cssReferences(fs.readFileSync(path.join(packageDir, file), 'utf8'))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), reference));
      if (target.startsWith('../')) {
        logger.warn(`npm-libraries: ${name}/${file} references ${reference}, outside the package; not copied.`);
      }
      else if (!fs.existsSync(path.join(packageDir, target)) || !fs.statSync(path.join(packageDir, target)).isFile()) {
        logger.warn(`npm-libraries: ${name}/${file} references ${reference}, which the package doesn't have.`);
      }
      else {
        found.add(target);
        if (target.endsWith('.css')) {
          css.push(target);
        }
      }
    }
  }
  return [...found];
}

// The relative url() and @import references of a stylesheet, without any
// ?query or #fragment (e.g. font.eot?#iefix).
function cssReferences(code) {
  const references = new Set();
  const css = code.replace(/\/\*[\s\S]*?\*\//g, '');
  const patterns = [
    /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g,
    /@import\s+(['"])([^'"]+)\1/g,
  ];
  for (const pattern of patterns) {
    for (const [, , reference] of css.matchAll(pattern)) {
      const url = reference.trim();
      if (!/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) {
        references.add(url.replace(/[?#].*$/, ''));
      }
    }
  }
  return [...references].filter(Boolean);
}

// Files of a package matching a pattern (`*` within a directory, `**` across
// them), as paths relative to the package. Nested node_modules are skipped.
function matchFiles(packageDir, pattern) {
  const regex = new RegExp(`^${pattern.replace(/^\.?\//, '').split(/(\*\*\/?|\*|\?)/).map((part) => {
    switch (part) {
      case '**/': return '(?:.*/)?';
      case '**': return '.*';
      case '*': return '[^/]*';
      case '?': return '[^/]';
      default: return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }).join('')}$`);
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(packageDir, dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(relative);
      }
      else if (entry.isFile() && regex.test(relative)) {
        found.push(relative);
      }
    }
  };
  walk('');
  return found.sort();
}
