const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist', 'ios-web');

const files = [
  'index.html',
  'datenschutz-audit.html',
  'datenschutz.html',
  'impressum.html',
  'objekt.html'
];

const directories = [
  'leistungen',
  'portal',
  'public'
];

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function copyFile(relativePath) {
  const source = path.join(rootDir, relativePath);
  const target = path.join(outDir, relativePath);
  if (!fs.existsSync(source)) return;
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyDirectory(relativePath) {
  const source = path.join(rootDir, relativePath);
  const target = path.join(outDir, relativePath);
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, target, {
    recursive: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== '.DS_Store';
    }
  });
}

remove(outDir);
ensureDir(outDir);

files.forEach(copyFile);
directories.forEach(copyDirectory);

console.log(`Prepared Capacitor web assets in ${path.relative(rootDir, outDir)}`);
