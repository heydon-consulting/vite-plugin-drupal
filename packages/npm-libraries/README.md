# @vite-plugin-drupal/npm-libraries

Copies prebuilt files out of npm packages into the Vite build output and
registers them in the Vite manifest. Drupal libraries can then reference the
files by their `node_modules` path with `vite: true`, and
[drupal/vite](https://www.drupal.org/project/vite) rewrites them to the copy
(or to the dev server while Vite is running).

Usually [@vite-plugin-drupal/libraries](../libraries) configures it from
`*.libraries.yml`, so you don't need to add it yourself. To use it directly:

```js
import npmLibraries from '@vite-plugin-drupal/npm-libraries';

npmLibraries({
  'powerbi-client': { files: ['dist/powerbi.min.js'], global: true },
  'countup.js': { files: ['dist/countUp.min.js'], namespace: 'countUp' },
  toc: { files: ['dist/toc.min.js'], global: true, version: '0.3.2' },
  dayjs: { files: [{ path: 'dayjs.min.js', global: true }, { path: 'plugin/utc.js', global: true }] },
  leaflet: { files: ['dist/leaflet.js', 'dist/leaflet.css'], global: true, copy: ['dist/images/*'] },
});
```

## Options, per package

- **`files`:** paths inside the package to copy, either strings or
  `{ path, global, namespace }` to set the options below per file.
- **`global`:** the file is a UMD/IIFE script that expects to run as a classic
  script. drupal/vite loads rewritten JS as `type="module"`, where top-level
  `this` is undefined, so the file is wrapped to run with `this` bound to the
  global object. Set it to a name (or list of names) instead of `true` when
  the script declares its globals as top-level variables (`var Foo = ...`);
  those are assigned to `globalThis` explicitly.
- **`namespace`:** exposes the file's exports as `globalThis[namespace]`, so
  other Drupal libraries can use it without importing it. An ES module is
  copied as-is, with its named exports also assigned to the global. A
  CommonJS file is wrapped with a `module` / `exports` stub; only
  self-contained files work (`require()` isn't supported).
- **`copy`:** other files of the package to copy as they are, as patterns
  relative to the package (`*` within a directory, `**` across them): files a
  script loads itself at runtime.
- **`version`:** the version in the copies' `<package>@<version>/` directory,
  instead of the one in the package's `package.json`.

Copies keep their path inside the package, under `<package>@<version>/` in
the build output. Files a copied stylesheet references with `url()` or
`@import` are copied too, so its relative URLs keep working.
