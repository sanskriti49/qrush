import { useCallback, useEffect, useRef, useState } from "react";
import { api, credentials, getSession, putSession, problem, ProductError, type Booking, type Opening, type ParticipantSession, type QueueStatus, type Registration } from "./productApi";

type Claim = { success: boolean; allocationId: string; unitId: string; leaseTtlSeconds: number };

/** Public journeys share the existing per-opening browser credentials. No cleanup releases a place. */
export function useRegistration(id: string) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const [identity, setIdentity] = useState<ParticipantSession | null>(() => getSession(id));
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [online, setOnline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const busy = useRef(false);
  const reserving = useRef(false);
  const queueRef = useRef(queue); queueRef.current = queue;
  const bookingRef = useRef(booking); bookingRef.current = booking;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const applyQueue = useCallback((next: QueueStatus) => {
    setQueue(next);
    // A server TTL is the authority; never restart a full countdown on refresh.
    setDeadline(next.heldUnitId && next.holdRemainingSeconds ? Date.now() + next.holdRemainingSeconds * 1000 : 0);
  }, []);

  useEffect(() => {
    let stopped = false;
    let refreshing = false;
    async function refresh() {
      if (refreshing || stopped) return;
      refreshing = true;
      try {
        const next = await api<Opening>(`/api/openings/${id}`);
        if (stopped) return;
        setOpening(next); setOffset(Date.parse(next.serverTime) - Date.now());
        setOnline(true); setMissing(false); setConnectionError("");
      } catch (e) {
        if (!stopped) { setOnline(false); setConnectionError(problem(e)); setMissing(e instanceof ProductError && e.status === 404); }
      } finally { refreshing = false; if (!stopped) setLoading(false); }
    }
    refreshRef.current = refresh;
    void refresh();
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 4000);
    const clock = setInterval(() => setNow(Date.now()), 250);
    window.addEventListener("focus", refresh);
    return () => { stopped = true; clearInterval(poll); clearInterval(clock); window.removeEventListener("focus", refresh); };
  }, [id]);

  useEffect(() => {
    if (!identity) return;
    let stopped = false;
    let refreshing = false;
    let lastEvent = 0;
    async function refreshQueue() {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const next = await api<QueueStatus>(`/api/waiting-room/${id}/status?${credentials(identity!)}`);
        if (!stopped) { applyQueue(next); setOnline(true); setConnectionError(""); }
      } catch (e) { if (!stopped) { setOnline(false); setConnectionError(problem(e)); } }
      finally { refreshing = false; }
    }
    void refreshQueue();
    const source = new EventSource(`/api/waiting-room/${id}/stream?${credentials(identity)}`);
    source.addEventListener("QUEUE_UPDATE", (event) => {
      if (stopped) return;
      try { applyQueue(JSON.parse((event as MessageEvent).data)); lastEvent = Date.now(); setOnline(true); } catch { void refreshQueue(); }
    });
    const poll = setInterval(() => { if (Date.now() - lastEvent > 3000) void refreshQueue(); }, 2000);
    window.addEventListener("focus", refreshQueue);
    return () => { stopped = true; source.close(); clearInterval(poll); window.removeEventListener("focus", refreshQueue); };
  }, [id, identity, revision, applyQueue]);

  useEffect(() => {
    if (!identity || queue?.status !== "CONFIRMED" || booking?.status === "CONFIRMED") return;
    let stopped = false;
    void api<Booking | null>(`/api/pools/${id}/allocation?${credentials(identity)}`).then((result) => {
      if (!stopped && result) setBooking(result);
    }).catch((e) => { if (!stopped) setError(problem(e)); });
    return () => { stopped = true; };
  }, [id, identity, queue?.status, booking?.status, revision]);

  useEffect(() => {
    if (!identity || !queue || queue.status === "CONFIRMED" || booking?.status !== "CONFIRMED") return;
    let stopped = false;
    // A cancellation in another tab must also update an already-open confirmation page.
    void api<Registration[]>("/api/registrations/lookup", "POST", { sessions: [{ flowId: id, claimantId: identity.claimantId, sessionToken: identity.sessionToken }] })
      .then((rows) => {
        const current = rows[0]?.history?.find((item) => item.allocationId === booking.allocationId);
        if (!stopped && current) setBooking(current);
      }).catch(() => { /* Keep the last verified booking and try on the next status change. */ });
    return () => { stopped = true; };
  }, [id, identity, queue?.status, booking?.status]);

  useEffect(() => {
    if (!identity || !queue?.admitted || queue.heldUnitId || booking?.status === "CONFIRMED" || reserving.current || busy.current) return;
    reserving.current = true;
    let stopped = false;
    void api<Claim>(`/api/openings/${id}/reserve?${credentials(identity)}`, "POST", { claimantId: identity.claimantId, admissionToken: queue.admissionToken })
      .then((result) => {
        if (!stopped && result.success) {
          applyQueue({ ...queue, heldUnitId: result.unitId, holdRemainingSeconds: result.leaseTtlSeconds });
          void refreshRef.current();
        }
      }).catch((e) => {
        if (!stopped && !(e instanceof ProductError && e.status === 409)) setError(problem(e));
      }).finally(() => { reserving.current = false; });
    return () => { stopped = true; };
  }, [id, identity, queue, booking?.status, pending, applyQueue]);

  async function act(action: string, run: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(""); setNotice("");
    try { await run(); }
    catch (e) { setError(problem(e, action)); }
    finally { busy.current = false; setPending(false); setRevision((v) => v + 1); void refreshRef.current(); }
  }
  const join = (name: string) => act("join", async () => {
    let session = currentIdentity.current;
    if (!session) session = await api<ParticipantSession>(`/api/flows/${id}/sessions`, "POST");
    session = { ...session, name: name.trim().slice(0, 60), openingName: opening?.name };
    putSession(id, session); setIdentity(session); currentIdentity.current = session;
    const next = await api<QueueStatus>(`/api/waiting-room/${id}/join?${credentials(session)}`, "POST");
    setBooking(null); applyQueue(next);
  });
  const confirm = () => act("confirm", async () => {
    const session = currentIdentity.current, current = queueRef.current;
    if (!session || !current?.heldUnitId) return;
    const result = await api<Claim>(`/api/pools/${id}/confirm?${credentials(session)}`, "POST", { claimantId: session.claimantId, unitId: current.heldUnitId, admissionToken: current.admissionToken });
    if (result.success) {
      setBooking(await api<Booking>(`/api/pools/${id}/allocation?${credentials(session)}`));
      applyQueue({ ...current, status: "CONFIRMED", admitted: false, heldUnitId: null });
      window.dispatchEvent(new Event("qrush-registrations-changed"));
    }
  });
  const leave = () => act("leave", async () => {
    const session = currentIdentity.current;
    if (!session) return;
    applyQueue(await api<QueueStatus>(`/api/waiting-room/${id}/leave?${credentials(session)}`, "POST"));
    setNotice("You’ve left the line. You can join again while spots are available.");
  });
  const cancel = () => act("cancel", async () => {
    const session = currentIdentity.current, current = bookingRef.current;
    if (!session || !current) return;
    const result = await api<Booking>(`/api/pools/${id}/cancel?${credentials(session)}`, "POST", { claimantId: session.claimantId, allocationId: current.allocationId });
    setBooking({ ...current, ...result }); setQueue(null); setDeadline(0);
    setNotice("Registration cancelled. Your spot is going back up for grabs.");
    window.dispatchEvent(new Event("qrush-registrations-changed"));
  });
  return { opening, identity, queue, booking, deadline, pending, error: error || connectionError, notice, loading, missing, online,
    now: now + offset, localNow: now, join, confirm, leave, cancel,
    retry: () => { setError(""); setConnectionError(""); setRevision((v) => v + 1); void refreshRef.current(); } };
}
