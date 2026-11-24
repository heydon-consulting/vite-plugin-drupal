// Loads every package, and checks each one exports a plugin factory.
import fs from 'node:fs';

let failed = false;
for (const dir of fs.readdirSync(new URL('../packages/', import.meta.url))) {
  const { name } = JSON.parse(fs.readFileSync(new URL(`../packages/${dir}/package.json`, import.meta.url), 'utf8'));
  try {
    const { default: plugin } = await import(name);
    if (typeof plugin !== 'function') {
      throw new Error('the default export is not a function');
    }
    console.log(`ok ${name}`);
  }
  catch (error) {
    failed = true;
    console.error(`not ok ${name}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
