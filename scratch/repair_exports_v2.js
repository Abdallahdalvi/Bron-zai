const fs = require('fs');

const filePath = 'd:\\C_Drive_Transfer\\bron\\src\\renderer\\components\\AgentSidebar.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Use a simple split and loop to find all occurrences of the export map block
let parts = content.split(".split('\\n')");
for (let i = 1; i < parts.length; i++) {
    let blockStart = parts[i].indexOf(".map(line => {");
    if (blockStart === 0 || blockStart === 1 || blockStart === 31 || blockStart === 30 || blockStart === 32) { // Approximate indentation
        // This is likely one of our export blocks
        // Find the end of this block which ends with ).join('\n').replace(...)
        let searchRange = parts[i].substring(0, 2000); // Look ahead
        let endMatch = searchRange.indexOf(".replace(/(<tr[\\s\\S]*?<\\/tr>)+/g");
        if (endMatch !== -1) {
            let fullEndIdx = searchRange.indexOf(");", endMatch) + 2;
            let block = searchRange.substring(0, fullEndIdx);
            
            let isHeader = "isHeader"; // String for replacement
            
            let repaired = block
                // 1. Handle --- by returning null
                .replace(/if \(t\.includes\('---'\)\) return '';/g, "if (t.includes('---')) return null;")
                // 2. Fix nowrap for headers
                .replace(/\$\{cells\.map\(c => \`<td style="(.*?padding: \d+px;)">\$\{c\}<\/td>\`\)\.join\(''\)\}/g, 
                          "${cells.map(c => `<td style=\"$1 ${isHeader ? 'white-space: nowrap;' : ''}\">${c}</td>`).join('')}")
                // 3. Filter nulls and join without gaps
                .replace(/\.join\('\\n'\)\s*\.replace\(\/\(<tr\[\\s\\S\]\*?<\/tr>\)\+\/g/g, ".filter(x => x !== null).join('').replace(/(<tr[\\s\\S]*?<\\/tr>)+/g");
            
            parts[i] = repaired + parts[i].substring(fullEndIdx);
        }
    }
}

content = parts.join(".split('\\n')");
fs.writeFileSync(filePath, content);
console.log('Successfully repaired all export blocks.');
