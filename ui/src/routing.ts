import { useEffect, useState } from 'react';

const SESSION_PATH_RE = /^\/sessions\/([^/]+)\/?$/;

export function getSessionIdFromPath(pathname = location.pathname): string | null {
  const match = pathname.match(SESSION_PATH_RE);
  return match?.[1] ?? null;
}

export const ADMIN_PATH = '/admin/llm';

export function isAdminPath(pathname = location.pathname): boolean {
  return pathname.replace(/\/+$/, '') === ADMIN_PATH;
}

export function useAdminRoute(): boolean {
  const [admin, setAdmin] = useState(() => isAdminPath());

  useEffect(() => {
    const sync = () => setAdmin(isAdminPath());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  return admin;
}

export function sessionPath(sessionId: string): string {
  return `/sessions/${sessionId}`;
}

export function navigate(path: string): void {
  if (location.pathname === path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useSessionRoute(): string | null {
  const [sessionId, setSessionId] = useState(() => getSessionIdFromPath());

  useEffect(() => {
    const sync = () => setSessionId(getSessionIdFromPath());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  return sessionId;
}
