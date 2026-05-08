
import json
import os
import re

log_path = r"C:\Users\devev\.gemini\antigravity\brain\a95e4d70-ca8f-462a-9b43-ef09835c11a1\.system_generated\logs\overview.txt"
output_dir = r"d:\C_Drive_Transfer\bron\src\renderer\components"

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

components = [
    "BrowserToolbar.tsx",
    "TabBar.tsx",
    "AgentSidebar.tsx",
    "MemoryPanel.tsx",
    "SettingsPanel.tsx"
]

files_found = {}

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            if "tool_calls" in data:
                for call in data["tool_calls"]:
                    if call["name"] in ["write_to_file", "replace_file_content", "multi_replace_file_content"]:
                        args = call["args"]
                        target = args.get("TargetFile", "")
                        for comp in components:
                            if comp in target:
                                if call["name"] == "write_to_file":
                                    files_found[comp] = args.get("CodeContent", "")
                                # For simplicity, we just take the last write_to_file
                                # We could handle replacements but usually the last write is enough or we can reconstruct
        except:
            continue

for comp, content in files_found.items():
    # Content is double-escaped in the log
    try:
        # First unescape from JSON string
        content = content.strip('"')
        # Then replace escaped newlines and quotes
        content = content.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
        
        # Sometimes it's still wrapped in quotes if it was a nested JSON string
        if content.startswith('"') and content.endswith('"'):
            content = content[1:-1].replace('\\n', '\n').replace('\\"', '"')

        dest_path = os.path.join(output_dir, comp)
        with open(dest_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Restored {comp}")
    except Exception as e:
        print(f"Error restoring {comp}: {e}")
