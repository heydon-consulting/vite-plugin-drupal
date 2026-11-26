# vite-plugin-drupal-libraries

## 0.3.0

### Minor Changes

- 8585595: Add `librariesDirExclude`: packages not to copy to `librariesDir`, which are versioned copies in the manifest as without it, for a site module that points their library at them.
- 3453b8c: Add `librariesDir`: npm files for contrib modules' `/libraries/<package>/` assets are copied unchanged to `<librariesDir>/<package>/`, where the modules look for them, instead of to versioned copies in the manifest. Only directories the build made are replaced or removed.

### Patch Changes

- Updated dependencies [3453b8c]
  - vite-plugin-drupal-npm-libraries@0.2.0

## 0.2.0

### Minor Changes

- 3e9c28c: Add a `webRoot` option for projects whose Drupal web root isn't `web/`, e.g. `docroot`, or `''` when Drupal is the project root. It defaults to `'web'`, so existing setups don't change. `extensionDirs()` and `findExtensions()` take it too, and the new `webPath()` helper joins paths in the web root.

## 0.1.1

### Patch Changes

- a0233ed: Document the drupal/vite patch from #3447335 that themes' ckeditor5-stylesheets need.
