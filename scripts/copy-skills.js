const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

const root = path.join(__dirname, '..');
const srcSkills = path.join(root, 'src', 'skills');
const distSkills = path.join(root, 'dist', 'main', 'skills');

for (const folder of ['builtin', 'custom']) {
  const srcPath = path.join(srcSkills, folder);
  const distPath = path.join(distSkills, folder);
  if (fs.existsSync(srcPath)) {
    console.log(`Copying ${folder} skills to dist/main/skills/${folder}...`);
    copyRecursiveSync(srcPath, distPath);
  }
}
console.log("Skill folders copied successfully!");
