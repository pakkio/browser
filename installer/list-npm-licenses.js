// Usage: node list-npm-licenses.js <node_modules dir> <output file>
// Writes "name@version  license  repository" for every installed package.
const fs = require('fs');
const path = require('path');

const [, , modulesDir, outFile] = process.argv;
const rows = [];

function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === '.bin') continue;
        const full = path.join(dir, entry.name);
        if (entry.name.startsWith('@')) { visit(full); continue; }
        const manifest = path.join(full, 'package.json');
        if (fs.existsSync(manifest)) {
            const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
            const license = typeof pkg.license === 'string' ? pkg.license
                : pkg.license && pkg.license.type ? pkg.license.type
                : Array.isArray(pkg.licenses) ? pkg.licenses.map(l => l.type).join(' OR ')
                : 'UNKNOWN';
            const repo = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '';
            rows.push(`${pkg.name}@${pkg.version}\t${license}\t${repo}`);
        }
        const nested = path.join(full, 'node_modules');
        if (fs.existsSync(nested)) visit(nested);
    }
}

visit(modulesDir);
rows.sort();
fs.writeFileSync(outFile, `${rows.length} packages\n\n${rows.join('\n')}\n`);
