const fs = require('fs');

const filePath = 'd:\\C_Drive_Transfer\\bron\\src\\renderer\\components\\AgentSidebar.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Function to repair the mapping logic
function repairMap(c) {
    // 1. Fix the Precipitation wrapping (add nowrap to headers)
    c = c.replace(/\$\{cells\.map\(c => \`<td style="(.*?padding: \d+px;)">\$\{c\}<\/td>\`\)\.join\(''\)\}/g, 
                  "${cells.map(c => `<td style=\"$1 ${isHeader ? 'white-space: nowrap;' : ''}\">${c}</td>`).join('')}");
    
    // 2. Fix the table separation (handle '---' and join without newline between rows)
    c = c.replace(/if \(t\.includes\('---'\)\) return '';/g, "if (t.includes('---')) return null;");
    
    // 3. Filter nulls and join without gaps
    c = c.replace(/\.join\('\\n'\)\s*\.replace\(\/\(<tr\[\\s\\S\]\*?<\/tr>\)\+\/g/g, ".filter(x => x !== null).join('').replace(/(<tr[\\s\\S]*?<\\/tr>)+/g");
    
    return c;
}

// Find the map blocks
const startMarkers = [
    "const htmlContent = msg.content\n                               .split('\\n')\n                               .map(line => {",
    "const htmlContent = msg.content\n                              .split('\\n')\n                              .map(line => {"
];

for (let marker of startMarkers) {
    let startIdx = content.indexOf(marker);
    if (startIdx !== -1) {
        let endMarker = ".replace(/(<tr[\\s\\S]*?<\\/tr>)+/g, match => `<table style=\"border-collapse: collapse; width: 100%; margin: 20px 0;";
        let endIdx = content.indexOf(endMarker, startIdx);
        if (endIdx !== -1) {
            // Find the end of the line
            let fullEndIdx = content.indexOf(");", endIdx) + 2;
            let block = content.substring(startIdx, fullEndIdx);
            let repaired = repairMap(block);
            content = content.substring(0, startIdx) + repaired + content.substring(fullEndIdx);
        }
    }
}

fs.writeFileSync(filePath, content);
console.log('Final export repair completed.');
