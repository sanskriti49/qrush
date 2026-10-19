export type Opening = {
  id: string; name: string; description: string; capacity: number;
  opensAt: string; createdAt: string; available: number; reserved: number;
  confirmed: number; waiting: number; status: "OPEN" | "SCHEDULED";
  registrationPath: string; serverTime: string;
};
export type ParticipantSession = {
  claimantId: string; sessionToken: string; name?: string; openingName?: string;
};
export type QueueStatus = {
  position: number; totalInQueue: number; estimatedWaitSeconds: number | null;
  admitted: boolean; admissionToken?: string; status: string;
  admissionRemainingSeconds?: number; heldUnitId?: string | null; holdRemainingSeconds?: number;
};
export type Booking = {
  allocationId: string; unitId: string; status: "CONFIRMED" | "CANCELLED";
  confirmedAt: string; cancelledAt?: string | null;
};
export type Registration = {
  flowId: string; name?: string; description?: string; opensAt?: string;
  status: "OK" | "SESSION_EXPIRED" | "NOT_FOUND"; queue?: QueueStatus; history?: Booking[];
  published?: boolean;
};
export class ProductError extends Error {
  constructor(readonly status: number) { super(`Request failed (${status})`); }
}
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ProductError(response.status);
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}
const prefix = "qrush-session-";
export function getSession(id: string): ParticipantSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(prefix + id) ?? "null");
    return value?.claimantId && value?.sessionToken ? value : null;
  } catch { return null; }
}
export function putSession(id: string, value: ParticipantSession) {
  try { localStorage.setItem(prefix + id, JSON.stringify(value)); } catch { /* The current page still works without storage. */ }
  window.dispatchEvent(new Event("qrush-registrations-changed"));
}
export function savedSessions() {
  const result: { flowId: string; claimantId: string; sessionToken: string }[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const flowId = key.slice(prefix.length);
      const value = getSession(flowId);
      if (value && /^[A-Za-z0-9_-]{1,80}$/.test(flowId)) result.push({ flowId, claimantId: value.claimantId, sessionToken: value.sessionToken });
    }
  } catch { /* Private browsing may disable storage. */ }
  return result.slice(0, 50);
}
export const credentials = (session: ParticipantSession) => new URLSearchParams({
  userId: session.claimantId, claimantId: session.claimantId, sessionToken: session.sessionToken,
}).toString();
export const lookupRegistrations = () => api<Registration[]>("/api/registrations/lookup", "POST", { sessions: savedSessions() });
export const registrationUrl = (id: string) => `${location.origin}/#r/${encodeURIComponent(id)}`;
export const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export function problem(error: unknown, action?: string) {
  const status = error instanceof ProductError ? error.status : 0;
  if (status === 401) return "We can’t unlock this saved registration. Its browser pass may have expired.";
  if (status === 403) return "Creating openings is available on this local workspace. You can still view public registrations.";
  if (status === 404) return "We couldn’t find this opening. Check the link and try again.";
  if (status === 400) return "Check the details and opening time, then try again.";
  if (status === 409) return action === "join" ? "Registration isn’t ready for you to join yet. Check the latest update below." : "Your saved spot changed. We’re checking your latest place now.";
  if (action === "cancel") return "We couldn’t check whether your cancellation went through. Refresh or retry; we’ll check the same booking.";
  if (action === "confirm") return "We couldn’t check your confirmation. Retry safely; an existing booking will stay the same.";
  return "We couldn’t connect just now. Please try again. Your saved registration stays here.";
}
