---
"vite-plugin-drupal-npm-libraries": minor
"vite-plugin-drupal-libraries": minor
---

Add `librariesDir`: npm files for contrib modules' `/libraries/<package>/` assets are copied unchanged to `<librariesDir>/<package>/`, where the modules look for them, instead of to versioned copies in the manifest. Only directories the build made are replaced or removed.
