# @vite-plugin-drupal/libraries

## 0.2.0

### Minor Changes

- 3e9c28c: Add a `webRoot` option for projects whose Drupal web root isn't `web/`, e.g. `docroot`, or `''` when Drupal is the project root. It defaults to `'web'`, so existing setups don't change. `extensionDirs()` and `findExtensions()` take it too, and the new `webPath()` helper joins paths in the web root.

## 0.1.1

### Patch Changes

- a0233ed: Document the drupal/vite patch from #3447335 that themes' ckeditor5-stylesheets need.
