
const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\devev\\.gemini\\antigravity\\brain\\a95e4d70-ca8f-462a-9b43-ef09835c11a1\\.system_generated\\logs\\overview.txt';
const outputDir = 'd:\\C_Drive_Transfer\\bron\\src\\renderer\\components';

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const components = [
    'BrowserToolbar.tsx',
    'TabBar.tsx',
    'AgentSidebar.tsx',
    'MemoryPanel.tsx',
    'SettingsPanel.tsx'
];

const filesFound = {};

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

lines.forEach(line => {
    try {
        const data = JSON.parse(line);
        if (data.tool_calls) {
            data.tool_calls.forEach(call => {
                if (['write_to_file', 'replace_file_content'].includes(call.name)) {
                    const args = call.args;
                    const target = args.TargetFile || '';
                    components.forEach(comp => {
                        if (target.includes(comp)) {
                            // We use regex to find the content because the JSON parsing might have escaped it differently
                            // But since we parsed the line as JSON, args.CodeContent or args.ReplacementContent should be strings
                            let fileContent = args.CodeContent || args.ReplacementContent;
                            if (fileContent) {
                                // Strip outer quotes if they exist and unescape
                                if (fileContent.startsWith('"') && fileContent.endsWith('"')) {
                                    fileContent = fileContent.slice(1, -1);
                                }
                                // The string from JSON.parse is already unescaped for standard characters,
                                // but the logs might have double-escaped newlines like "\\n"
                                fileContent = fileContent.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                                filesFound[comp] = fileContent;
                            }
                        }
                    });
                }
            });
        }
    } catch (e) {
        // Ignore lines that aren't JSON
    }
});

Object.keys(filesFound).forEach(comp => {
    const destPath = path.join(outputDir, comp);
    fs.writeFileSync(destPath, filesFound[comp], 'utf8');
    console.log(`Restored ${comp}`);
});
