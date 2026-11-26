# vite-plugin-drupal-npm-libraries

## 0.2.0

### Minor Changes

- 3453b8c: Add `librariesDir`: npm files for contrib modules' `/libraries/<package>/` assets are copied unchanged to `<librariesDir>/<package>/`, where the modules look for them, instead of to versioned copies in the manifest. Only directories the build made are replaced or removed.
