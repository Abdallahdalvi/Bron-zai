"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickAndPrepareAgentAttachments = pickAndPrepareAgentAttachments;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const MAX_TEXT_CHARS = 20000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const TEXT_EXTS = new Set([
    '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h',
    '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yml', '.yaml', '.ini', '.cfg',
    '.env', '.sql', '.sh', '.ps1',
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const MIME_BY_EXT = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.log': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
};
async function pickAndPrepareAgentAttachments(parentWindow) {
    const options = {
        title: 'Attach files or images',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'All supported', extensions: ['txt', 'md', 'json', 'csv', 'tsv', 'pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
            { name: 'Documents', extensions: ['txt', 'md', 'json', 'csv', 'tsv', 'pdf', 'doc', 'docx'] },
            { name: 'All files', extensions: ['*'] },
        ],
    };
    const result = parentWindow
        ? await electron_1.dialog.showOpenDialog(parentWindow, options)
        : await electron_1.dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0)
        return [];
    const attachments = [];
    for (const filePath of result.filePaths.slice(0, 6)) {
        try {
            attachments.push(await prepareAttachment(filePath));
        }
        catch {
            attachments.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: path_1.default.basename(filePath),
                path: filePath,
                kind: 'unsupported',
                mimeType: 'application/octet-stream',
                sizeBytes: 0,
                note: 'Could not read this file.',
            });
        }
    }
    return attachments;
}
async function prepareAttachment(filePath) {
    const stat = fs_1.default.statSync(filePath);
    const ext = path_1.default.extname(filePath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
    const base = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: path_1.default.basename(filePath),
        path: filePath,
        kind: 'unsupported',
        mimeType,
        sizeBytes: stat.size,
    };
    if (IMAGE_EXTS.has(ext)) {
        if (stat.size > MAX_IMAGE_BYTES) {
            return {
                ...base,
                kind: 'unsupported',
                note: `Image is too large (${formatBytes(stat.size)}). Keep images under ${formatBytes(MAX_IMAGE_BYTES)}.`,
            };
        }
        const bytes = fs_1.default.readFileSync(filePath);
        return {
            ...base,
            kind: 'image',
            imageDataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
        };
    }
    const bytes = fs_1.default.readFileSync(filePath);
    const extLooksText = TEXT_EXTS.has(ext);
    const looksText = extLooksText || isProbablyText(bytes);
    if (!looksText) {
        const unsupportedNote = ext === '.pdf' || ext === '.doc' || ext === '.docx'
            ? 'This format cannot be parsed locally yet. Convert to .txt/.md or paste the important section.'
            : 'Binary file preview is not available yet.';
        return { ...base, kind: 'unsupported', note: unsupportedNote };
    }
    const text = bytes.toString('utf8').replace(/\u0000/g, '').trim();
    const truncated = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n...[truncated]` : text;
    return {
        ...base,
        kind: 'text',
        textContent: truncated,
        note: text.length > MAX_TEXT_CHARS ? 'Long file was truncated for prompt safety.' : undefined,
    };
}
function isProbablyText(buf) {
    if (buf.length === 0)
        return true;
    const sample = buf.subarray(0, Math.min(buf.length, 4000));
    let control = 0;
    for (const b of sample) {
        if (b === 9 || b === 10 || b === 13)
            continue;
        if (b < 32 || b === 127)
            control++;
    }
    return control / sample.length < 0.08;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
//# sourceMappingURL=attachments.js.map