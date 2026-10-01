const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('.runtime/licenses/npm');
fs.mkdirSync(root, { recursive: true });
const inventory = [];
function visit(modules) {
  if (!fs.existsSync(modules)) return;
  for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(modules, entry.name);
    if (entry.name.startsWith('@')) { visit(folder); continue; }
    const manifest = path.join(folder, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const name = `${pkg.name.replaceAll('/', '__')}@${pkg.version}`;
    const destination = path.join(root, name);
    fs.mkdirSync(destination, { recursive: true });
    const licenses = fs.readdirSync(folder).filter(file => /^(licen[cs]e|copying|notice|copyright)/i.test(file) && fs.statSync(path.join(folder,file)).isFile());
    // Some packages place their copyright and license directly in the README.
    if (!licenses.length) licenses.push(...fs.readdirSync(folder).filter(file => /^readme/i.test(file) && fs.statSync(path.join(folder,file)).isFile()));
    for (const file of licenses) fs.copyFileSync(path.join(folder,file), path.join(destination,file));
    inventory.push({name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository,files:licenses});
    visit(path.join(folder,'node_modules'));
  }
}
visit('node_modules');
fs.writeFileSync(path.join(root,'inventory.json'),JSON.stringify(inventory,null,2));
console.log(JSON.stringify({packages:inventory.length,withoutLicenseFile:inventory.filter(p=>!p.files.length).map(p=>({name:p.name,license:p.license}))},null,2));
