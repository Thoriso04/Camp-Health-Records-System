// Type definition for Electron Preload script exposed on window
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, data?: any) => Promise<any>;
      on?: (channel: string, func: (...args: any[]) => void) => void;
    };
  }
}

export const apiService = {
  /**
   * Invokes an IPC channel in the Electron main process, or falls back during browser dev
   */
  async request<T = any>(channel: string, payload?: any): Promise<T> {
    if (window.electronAPI?.invoke) {
      return await window.electronAPI.invoke(channel, payload);
    }

    // Fallback mock handling for standalone React browser testing
    console.warn(`[Dev Fallback] IPC Channel invoked: ${channel}`, payload);
    return { success: true } as unknown as T;
  },

  /**
   * Like request(), but throws when the backend answers { success: false }.
   * The main process reports problems that way instead of rejecting, so a
   * plain request() would let a failed save look like a successful one.
   */
  async requestOrThrow<T = any>(channel: string, payload?: any): Promise<T> {
    const result: any = await this.request(channel, payload);
    if (result && result.success === false) {
      throw new Error(result.error || result.message || 'The request failed.');
    }
    return result as T;
  },

  /**
   * Listens for asynchronous events coming from the Electron main process
   */
  on(channel: string, callback: (...args: any[]) => void): void {
    if (window.electronAPI?.on) {
      window.electronAPI.on(channel, callback);
    } else {
      console.warn(`[Dev Fallback] Listening on IPC Channel: ${channel}`);
    }
  }
};
