const HANDOFF_CHANNEL = 'journal_key_handoff';

export const sessionHandoff = {
  /**
   * Broadcast the encryption key to any listening duplicate tabs right now.
   * This is called by the active tab just before it unloads/closes.
   */
  broadcastEncryptionKeyHandoff(key: string): void {
    if (typeof BroadcastChannel === 'undefined') return;
    
    // We explicitly leave this channel open for 100ms so the message clears the I/O queue
    // before the browser fully destroys the tab's JS context.
    const channel = new BroadcastChannel(HANDOFF_CHANNEL);
    channel.postMessage({ type: 'key_push', key });
    setTimeout(() => channel.close(), 100);
  },

  /**
   * Listen for an active push of the encryption key from a dying active tab.
   * This is used by duplicate tabs sitting on the "Multiple tabs blocked" screen.
   */
  listenForKeyPush(onKeyReceived: (key: string) => void): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    
    const channel = new BroadcastChannel(HANDOFF_CHANNEL);
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'key_push' && event.data.key) {
        onKeyReceived(event.data.key);
      }
    };
    
    channel.addEventListener('message', handler);
    
    return () => {
      channel.removeEventListener('message', handler);
      channel.close();
    };
  }
};
