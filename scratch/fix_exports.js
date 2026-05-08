const fs = require('fs');
const path = require('path');

const filePath = 'd:\\C_Drive_Transfer\\bron\\src\\renderer\\components\\AgentSidebar.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Function to fix the export logic in a block of code
function fixExportBlock(code) {
    return code
        .replace(/if \(t\.includes\('---'\)\) return '';/g, "if (t.includes('---')) return null;")
        .replace(/\.map\(c => \`<td style="border: 1px solid #e2e8f0; padding: 12px;">\$\{c\}<\/td>\`\)/g, '.map(c => `<td style="border: 1px solid #e2e8f0; padding: 12px; ${isHeader ? \'white-space: nowrap;\' : \'\'}">${c}</td>`)')
        .replace(/\.map\(c => \`<td style="border: 1px solid #ddd; padding: 10px;">\$\{c\}<\/td>\`\)/g, '.map(c => `<td style="border: 1px solid #ddd; padding: 10px; ${isHeader ? \'white-space: nowrap;\' : \'\'}">${c}</td>`)')
        .replace(/\.join\('\\n'\)\s*\.replace\(\/\(<tr\[\\s\\S\]\*?<\/tr>\)\+\/g/g, ".filter(x => x !== null)\n                               .join('\\n')\n                               .replace(/(<tr[\\s\\S]*?<\\/tr>)+/g")
        .replace(/\)\.join\(''\)\}/g, ").join('')}\${isHeader ? '</th>' : ''}") // This might be too complex
    ;
}

// Actually, I'll just do a direct string replacement for the chunks I want.

const oldChunk1 = `const htmlContent = msg.content
                               .split('\\n')
                               .map(line => {
                                 const t = line.trim();
                                 if (t.startsWith('|')) {
                                   const cells = t.split('|').slice(1, -1).map(c => c.trim());
                                   if (t.includes('---')) return '';
                                   const isHeader = !inTable;
                                   inTable = true;
                                   const res = \`<tr style="\${isHeader ? 'background-color: #2a4365; color: white; font-weight: bold;' : (tableRowIdx % 2 === 0 ? 'background-color: #f8fafc;' : 'background-color: #ffffff;')}">
                                     \${cells.map(c => \`<td style="border: 1px solid #e2e8f0; padding: 12px;">\${c}</td>\`).join('')}
                                   </tr>\`;
                                   tableRowIdx++;
                                   return res;
                                 } else {
                                   if (inTable) { inTable = false; tableRowIdx = 0; }
                                   if (t.startsWith('###')) return \\\`<h3>\\\${t.replace(/^#{3,}\\\\s*/, '')}</h3>\\\`;
                                   if (t.startsWith('##')) return \\\`<h2>\\\${t.replace(/^#{2}\\\\s*/, '')}</h2>\\\`;
                                   if (t.startsWith('#')) return \\\`<h1>\\\${t.replace(/^#\\\\s*/, '')}</h1>\\\`;
                                   if (t === '') return '<br/>';
                                   return \\\`<p>\\\${line}</p>\\\`;
                                 }
                               })
                               .join('\\n')
                               .replace(/(<tr[\\\\s\\\\S]*?<\\\\/tr>)+/g, match => \\\`<table style="border-collapse: collapse; width: 100%; margin: 20px 0; border: 1px solid #e2e8f0;">\\\${match}</table>\\\`);`;

// I'll just use regex to find the map blocks and replace them.

content = content.replace(/const htmlContent = msg\.content\s*\.split\('\\n'\)\s*\.map\(line => \{.*?\}\)\s*\.join\('\\n'\)\s*\.replace\(\/\(<tr\[\\s\\S\]\*?<\/tr>\)\+\/g, match => .*?\);/gs, (match) => {
    let fixed = match
        .replace(/if \(t\.includes\('---'\)\) return '';/g, "if (t.includes('---')) return null;")
        .replace(/\.map\(c => \`<td style="(.*?padding: \d+px;)">\$\{c\}<\/td>\`\)/g, '.map(c => `<td style="$1 ${isHeader ? \'white-space: nowrap;\' : \'\'}">${c}</td>`)')
        .replace(/\.join\('\\n'\)/, ".filter(x => x !== null).join('\\n')")
        .replace(/match => \`(.*?)\$\{match\}(.*?)\`/g, 'match => `$1${match.replace(/\\n/g, "")}$2`');
    return fixed;
});

fs.writeFileSync(filePath, content);
console.log('Patched exports successfully');
