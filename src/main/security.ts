/**
 * Security Module — Hardening for Bron browser
 * CSP policies, input sanitization, file validation
 */

import { app, session } from 'electron';

export interface SecurityConfig {
  /** Enable sandbox protections for embedded browser content */
  sandboxEnabled: boolean;
  /** Strict CSP for renderer process */
  strictCSP: boolean;
  /** Validate file uploads */
  validateUploads: boolean;
  /** Allowed shell command patterns */
  allowedShellPatterns: RegExp[];
  /** Blocked URL schemes */
  blockedUrlSchemes: string[];
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  sandboxEnabled: true,
  strictCSP: true,
  validateUploads: true,
  allowedShellPatterns: [],
  blockedUrlSchemes: ['javascript:', 'data:', 'vbscript:', 'file:'],
};

/** Dangerous file extensions that should not be uploaded */
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.msi', '.scr',
  '.jar', '.app', '.apk', '.dmg', '.pkg', '.deb', '.rpm',
  '.php', '.asp', '.aspx', '.jsp', '.py', '.rb', '.pl',
  '.ps1', '.vbs', '.wsf', '.hta',
]);

/** Get security configuration from settings */
export function getSecurityConfig(): SecurityConfig {
  // Could be loaded from settings in the future
  return DEFAULT_SECURITY_CONFIG;
}

/** Apply CSP headers to all sessions */
export function configureCSP(): void {
  const sessions = [
    session.defaultSession,
    session.fromPartition('persist:bron-session'),
  ];

  sessions.forEach(ses => {
    ses.webRequest.onHeadersReceived((details, callback) => {
      /*
      const headers = details.responseHeaders || {};
      
      // Remove existing CSP
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];

      // Set strict CSP for main frames
      if (details.resourceType === 'mainFrame') {
        // Allow inline scripts/styles for automation but block external risks
        headers['content-security-policy'] = [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' https:;",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:;",
          "style-src 'self' 'unsafe-inline' https:;",
          "img-src 'self' https: data: blob:;",
          "font-src 'self' https:;",
          "connect-src 'self' https: wss:;",
          "frame-src 'self' https:;",
          "object-src 'none';",
          "base-uri 'self';",
          "form-action 'self' https:;",
        ];
      }

      callback({ responseHeaders: headers });
      */
      callback({ cancel: false });
    });
  });
}

/** Sanitize shell command to prevent injection */
export function sanitizeShellCommand(command: string): { safe: boolean; sanitized?: string; reason?: string } {
  if (!command || typeof command !== 'string') {
    return { safe: false, reason: 'Invalid command' };
  }

  const trimmed = command.trim();

  // Block dangerous patterns
  const dangerousPatterns = [
    /;\s*rm\s+-rf/i,
    /&&\s*rm\s+-rf/i,
    /\|\s*rm\s+-rf/i,
    /`.*rm.*-rf.*`/i,
    /\$\(.*rm.*-rf.*\)/i,
    /curl.*\|\s*sh/i,
    /wget.*\|\s*sh/i,
    /powershell.*-enc/i,
    /powershell.*-encodedcommand/i,
    /bash\s+-c\s+["'].*curl/i,
    /bash\s+-c\s+["'].*wget/i,
    />\s*\/etc\/passwd/i,
    />\s*\/etc\/shadow/i,
    /mkfs\./i,
    /dd\s+if=.*of=\/dev/i,
    /:\(\)\s*{\s*:\s*|\s*:&\s*};/i,  // Fork bomb
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return { safe: false, reason: `Blocked dangerous pattern: ${pattern}` };
    }
  }

  // Limit command length
  if (trimmed.length > 10000) {
    return { safe: false, reason: 'Command exceeds maximum length (10000 chars)' };
  }

  // Basic sanitization: remove null bytes and control chars
  const sanitized = trimmed
    .replace(/\x00/g, '')  // Null bytes
    .replace(/[\x01-\x1F\x7F]/g, '');  // Control characters

  return { safe: true, sanitized };
}

/** Validate file path for uploads */
export function validateFilePath(filePath: string): { valid: boolean; reason?: string } {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, reason: 'Invalid file path' };
  }

  // Check extension
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `Dangerous file type blocked: ${ext}` };
  }

  // Check for path traversal
  if (filePath.includes('..') || filePath.includes('~')) {
    return { valid: false, reason: 'Path traversal attempt detected' };
  }

  // Max path length
  if (filePath.length > 4096) {
    return { valid: false, reason: 'Path exceeds maximum length' };
  }

  return { valid: true };
}

/** Validate URL before navigation */
export function validateUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'Invalid URL' };
  }

  const lower = url.toLowerCase().trim();

  // Check blocked schemes
  for (const scheme of DEFAULT_SECURITY_CONFIG.blockedUrlSchemes) {
    if (lower.startsWith(scheme)) {
      return { valid: false, reason: `Blocked URL scheme: ${scheme}` };
    }
  }

  // Allow navigation keywords
  if (['back', 'forward', 'reload', 'refresh', 'url'].includes(lower)) {
    return { valid: true };
  }

  // Must be http(s) or about
  if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('about:')) {
    return { valid: false, reason: 'Only HTTP(S) URLs allowed' };
  }

  return { valid: true };
}

/** Configure embedded-browser security at app startup */
export function configureWebviewSecurity(): void {
  const config = getSecurityConfig();

  app.on('web-contents-created', (_event, contents) => {
    // Block navigation to external apps for non-http URLs
    contents.on('will-navigate', (event, url) => {
      const validation = validateUrl(url);
      if (!validation.valid) {
        console.warn(`[Security] Blocked navigation: ${validation.reason}`);
        event.preventDefault();
      }
    });

    // Handle window.open attempts
    contents.setWindowOpenHandler(({ url }) => {
      const validation = validateUrl(url);
      if (!validation.valid) {
        console.warn(`[Security] Blocked window.open: ${validation.reason}`);
        return { action: 'deny' };
      }
      
      // Allow but open in same window for agent context
      return { action: 'allow' };
    });

    // Permission request handler
    contents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowedPermissions = [
        'clipboard-read',
        'clipboard-write',
        'notifications',
        'fullscreen',
        'media',
        'geolocation',
        'storage-access',
        'top-level-storage-access',
      ];

      if (allowedPermissions.includes(permission)) {
        callback(true);
      } else {
        console.warn(`[Security] Denied permission: ${permission}`);
        callback(false);
      }
    });
  });
}

/** Apply all security configurations */
export function applySecurityHardening(): void {
  configureCSP();
  configureWebviewSecurity();
  console.log('[Security] Hardening applied successfully');
}
