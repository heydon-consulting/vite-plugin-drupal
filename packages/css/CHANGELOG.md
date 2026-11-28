# vite-plugin-drupal-css

## 0.2.2

### Patch Changes

- Updated dependencies [78e3c48]
  - vite-plugin-drupal-libraries@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [8585595]
- Updated dependencies [3453b8c]
  - vite-plugin-drupal-libraries@0.3.0

## 0.2.0

### Minor Changes

- 3e9c28c: Add a `webRoot` option for projects whose Drupal web root isn't `web/`, e.g. `docroot`, or `''` when Drupal is the project root. It defaults to `'web'`, so existing setups don't change. `extensionDirs()` and `findExtensions()` take it too, and the new `webPath()` helper joins paths in the web root.

### Patch Changes

- Updated dependencies [3e9c28c]
  - vite-plugin-drupal-libraries@0.2.0
