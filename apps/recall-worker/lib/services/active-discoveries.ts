// Active Discovery Registry
// Tracks in-progress discoveries for admin monitoring and cancellation

export interface ActiveDiscovery {
  id: string;
  companyId: string;
  companyName: string;
  email: string;
  startedAt: Date;
  progress: {
    current: number;
    total: number;
    currentCitation?: string;
  };
  abortController: AbortController;
}

class ActiveDiscoveryRegistry {
  private discoveries: Map<string, ActiveDiscovery> = new Map();

  /**
   * Register a new active discovery
   * Returns an AbortController that can be used to cancel the discovery
   */
  register(
    discoveryId: string,
    companyId: string,
    companyName: string,
    email: string
  ): AbortController {
    const abortController = new AbortController();

    const discovery: ActiveDiscovery = {
      id: discoveryId,
      companyId,
      companyName,
      email,
      startedAt: new Date(),
      progress: {
        current: 0,
        total: 20, // Default expected total
      },
      abortController,
    };

    this.discoveries.set(discoveryId, discovery);
    console.log(`[ActiveDiscoveries] Registered discovery: ${discoveryId} for ${companyName}`);

    return abortController;
  }

  /**
   * Update progress for an active discovery
   */
  updateProgress(
    discoveryId: string,
    current: number,
    total: number,
    currentCitation?: string
  ): void {
    const discovery = this.discoveries.get(discoveryId);
    if (discovery) {
      discovery.progress = { current, total, currentCitation };
    }
  }

  /**
   * Unregister a discovery when it completes or is cancelled
   */
  unregister(discoveryId: string): void {
    const discovery = this.discoveries.get(discoveryId);
    if (discovery) {
      this.discoveries.delete(discoveryId);
      console.log(`[ActiveDiscoveries] Unregistered discovery: ${discoveryId}`);
    }
  }

  /**
   * Cancel an active discovery
   * Returns true if the discovery was found and cancelled
   */
  cancel(discoveryId: string): boolean {
    const discovery = this.discoveries.get(discoveryId);
    if (discovery) {
      console.log(`[ActiveDiscoveries] Cancelling discovery: ${discoveryId}`);
      discovery.abortController.abort();
      return true;
    }
    return false;
  }

  /**
   * Check if a discovery is cancelled
   */
  isAborted(discoveryId: string): boolean {
    const discovery = this.discoveries.get(discoveryId);
    return discovery?.abortController.signal.aborted ?? false;
  }

  /**
   * Get the AbortSignal for a discovery
   */
  getSignal(discoveryId: string): AbortSignal | undefined {
    return this.discoveries.get(discoveryId)?.abortController.signal;
  }

  /**
   * List all active discoveries (for admin panel)
   */
  list(): Omit<ActiveDiscovery, 'abortController'>[] {
    return Array.from(this.discoveries.values()).map(d => ({
      id: d.id,
      companyId: d.companyId,
      companyName: d.companyName,
      email: d.email,
      startedAt: d.startedAt,
      progress: d.progress,
    }));
  }

  /**
   * Get count of active discoveries
   */
  count(): number {
    return this.discoveries.size;
  }
}

// Export singleton instance
export const activeDiscoveries = new ActiveDiscoveryRegistry();
