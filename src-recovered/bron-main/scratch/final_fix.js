const fs = require('fs');
const filePath = 'd:\\C_Drive_Transfer\\bron\\src\\renderer\\components\\AgentSidebar.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix the Precipitation wrapping and header logic in BOTH blocks
// We look for the td padding and check if isHeader is being used.
content = content.replace(/(\$\{cells\.map\(c => \`<td style="border: 1px solid (?:#e2e8f0|#ddd); padding: (?:12px|10px);)(.*?)("\)>)\$\{c\}<\/td>\`\)\.join\(''\)\}/g, 
  (match, p1, p2, p3) => {
    // If it doesn't already have the nowrap check, add it.
    if (!match.includes('white-space: nowrap;')) {
        return `${p1} \${isHeader ? 'white-space: nowrap;' : ''}${p3}\${c}</td>\`).join('')}`;
    }
    return match;
});

// 2. Fix the table separation (handle '---' and join without newline between rows)
content = content.replace(/if \(t\.includes\('---'\)\) return '';/g, "if (t.includes('---')) return null;");

// 3. Fix the join and replace logic to group rows correctly
// This regex is broad enough to catch both indented versions
content = content.replace(/\.join\('\\n'\)\s+\.replace\(\/\(<tr\[\\s\\S\]\*?<\/tr>\)\+\/g/g, 
  ".filter(x => x !== null).join('').replace(/(<tr[\\s\\S]*?<\\/tr>)+/g");

fs.writeFileSync(filePath, content);
console.log('Successfully applied table grouping and wrapping fixes.');
