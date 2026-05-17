import type { BrowserViewportRect, RuntimeContext } from '../shared/types';

export type BrowserHostBackend = 'webcontentsview';

interface BrowserViewportState extends BrowserViewportRect {
  updatedAt: number;
}

/**
 * Tracks the intended browser content rectangle for the main-process hosted
 * browser surface.
 */
export class BrowserHostCoordinator {
  private readonly viewportByWindowId = new Map<number, BrowserViewportState>();
  private backend: BrowserHostBackend = 'webcontentsview';
  private viewportListener: ((windowWebContentsId: number, viewport: BrowserViewportState) => void) | null = null;

  getBackend(): BrowserHostBackend {
    return this.backend;
  }

  setBackend(next: BrowserHostBackend): void {
    this.backend = next;
  }

  setViewport(windowWebContentsId: number, viewport: BrowserViewportRect): { applied: boolean } {
    const width = Math.max(0, Math.round(Number(viewport.width || 0)));
    const height = Math.max(0, Math.round(Number(viewport.height || 0)));
    const x = Math.max(0, Math.round(Number(viewport.x || 0)));
    const y = Math.max(0, Math.round(Number(viewport.y || 0)));

    const nextViewport = {
      x,
      y,
      width,
      height,
      activeTabId: viewport.activeTabId || null,
      sidebarOpen: !!viewport.sidebarOpen,
      updatedAt: Date.now(),
    };
    this.viewportByWindowId.set(windowWebContentsId, nextViewport);
    this.viewportListener?.(windowWebContentsId, nextViewport);

    return { applied: true };
  }

  getViewport(windowWebContentsId: number): BrowserViewportState | null {
    return this.viewportByWindowId.get(windowWebContentsId) || null;
  }

  clearWindow(windowWebContentsId: number): void {
    this.viewportByWindowId.delete(windowWebContentsId);
  }

  onViewportChanged(listener: ((windowWebContentsId: number, viewport: BrowserViewportState) => void) | null): void {
    this.viewportListener = listener;
  }

  buildRuntimeContext(base: RuntimeContext): RuntimeContext {
    return {
      ...base,
      browserBackend: this.backend,
    };
  }
}
