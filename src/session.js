export const SESSION_ID = (() => {
  try {
    const urlSid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sid') : null;
    if (urlSid) {
      localStorage.setItem('session_id', urlSid);
      return urlSid;
    }
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('session_id') : null;
    if (stored) return stored;
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('session_id', id);
    }
    return id;
  } catch {
    return 'fallback-session-' + Date.now();
  }
})();
