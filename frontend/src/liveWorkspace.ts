import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyProblem } from "./uiCopy";
import {
  initial,
  useSimulationWorkspace,
  type Action,
  type Event,
  type Phase,
  type ScenarioId,
  type State,
} from "./workspaceEngine";

type Session = { claimantId: string; sessionToken: string; name?: string };
type QueueStatus = {
  position: number;
  totalInQueue: number;
  estimatedWaitSeconds: number | null;
  admitted: boolean;
  admissionToken?: string;
  status: string;
  admissionRemainingSeconds?: number;
  heldUnitId?: string | null;
  holdRemainingSeconds?: number;
};
type Claim = {
  success: boolean;
  allocationId?: string | number;
  unitId: string;
  message: string;
  leaseTtlSeconds?: number;
};
type Allocation = {
  id?: string | number;
  allocationId?: string | number;
  unitId: string;
};
type Snapshot = {
  id: ScenarioId;
  name: string;
  resourcePrefix: string;
  sampledAt?: string;
  totalUnits: number;
  policy: {
    maxConcurrent: number;
    admissionRate: number;
    holdSeconds: number;
    adaptive: boolean;
  };
  metrics: {
    activeCheckouts: number;
    admissionRatePerSec: number;
    observedLatencyMs: number;
    queueLength: number;
    available: number;
    held: number;
    confirmed: number;
    requests: number;
    recycled: number;
    admissions?: number;
    arrivals?: number;
  };
  inventory: {
    unitId: string;
    status: string;
    leaseRemainingSeconds: number;
    heldByYou: boolean;
  }[];
  events: { id: string; at: string | number; type: string; message: string }[];
  scenario: { mode: "NORMAL" | "SLOW" | "OUTAGE" };
  load: { running: boolean; total: number; completed: number; failed: number };
};
type FlowMetadata = { id: ScenarioId; name: string; resourcePrefix: string; totalUnits: number };

const MODE_KEY = "qrush-data-mode";
const FLOW_KEY = "qrush-live-flow";
const sessionKey = (flow: ScenarioId) => `qrush-session-${flow}`;
function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ }
}
function loadSession(flow: ScenarioId): Session | null {
  try {
    const value = JSON.parse(stored(sessionKey(flow)) ?? "null") as Session | null;
    return value?.claimantId && value.sessionToken ? value : null;
  } catch { return null; }
}
function sessionQuery(session: Session | null) {
  return session
    ? `?${new URLSearchParams({ userId: session.claimantId, claimantId: session.claimantId, sessionToken: session.sessionToken })}`
    : "";
}
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T | null> {
  const response = await fetch(path, {
    method,
    signal: AbortSignal.timeout(12000),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.message ?? data?.error ?? `Request failed (${response.status})`, response.status);
  return data as T;
}
function blank(flow: ScenarioId): State {
  return {
    ...initial(flow), mode: "live", backendStatus: "checking", connected: true,
    participantId: "Not joined", resources: [], latency: 0, rate: 0,
    events: [], notice: "", streamStatus: "connecting",
  };
}
function eventKind(type: string): Event["kind"] {
  const value = type.toLowerCase();
  return value.includes("confirm") ? "confirm"
    : value.includes("recycl") || value.includes("expir") || value.includes("releas") ? "recycle"
    : value.includes("admi") || value.includes("hold") ? "admit"
    : value.includes("control") || value.includes("policy") || value.includes("scenario") || value.includes("load") ? "control" : "info";
}
function participantPhase(queue: QueueStatus | null, allocation: Allocation | null, state: State): Phase {
  if (allocation || queue?.status === "CONFIRMED") return "confirmed";
  if (queue?.heldUnitId && (queue.holdRemainingSeconds ?? 0) > 0) return "admitted";
  if (queue?.status === "SOLD_OUT" || queue?.status === "CLOSED") return state.phase === "ready" || state.phase === "expired" ? state.phase : "queued";
  if (queue?.status === "WAITING" || queue?.status === "ADMITTED") return "queued";
  if (state.phase === "admitted" && !queue?.heldUnitId) return "expired";
  return state.phase === "expired" ? "expired" : "ready";
}

export function useWorkspace() {
  const [mode, setMode] = useState<"live" | "simulation">(() => stored(MODE_KEY) === "simulation" ? "simulation" : "live");
  const [flow, setFlow] = useState<ScenarioId>(() => {
    const saved = stored(FLOW_KEY);
    return saved === "product" || saved === "workshop" ? saved : "hackathon";
  });
  const simulation = useSimulationWorkspace(mode === "simulation");
  const [live, setLive] = useState<State>(() => blank(flow));
  const liveRef = useRef(live);
  liveRef.current = live;
  const session = useRef<Session | null>(loadSession(flow));
  const queue = useRef<QueueStatus | null>(null);
  const lastQueueEventAt = useRef(0);
  const allocation = useRef<Allocation | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const catalog = useRef<State["catalog"]>({});
  const activeFlow = useRef(flow);
  const detached = useRef(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const holding = useRef(false);
  const busy = useRef(false);
  const pollNow = useRef<() => Promise<void>>(async () => {});
  const previousSample = useRef<{ at: number; admitted: number; arrivals: number } | null>(null);

  const publish = useCallback((snapshot: Snapshot, expectedFlow: ScenarioId) => {
    if (activeFlow.current !== expectedFlow) return;
    if (!Array.isArray(snapshot.inventory) || !Array.isArray(snapshot.events) || !snapshot.policy || !snapshot.metrics || !snapshot.scenario || !snapshot.load) {
      throw new Error("This backend does not support the live workspace contract.");
    }
    latest.current = snapshot;
    const now = Date.now();
    const q = queue.current;
    const a = allocation.current;
    const currentSession = session.current;
    const admitted = snapshot.metrics.admissions ?? snapshot.metrics.confirmed + snapshot.metrics.held + snapshot.metrics.recycled;
    const arrivals = snapshot.metrics.arrivals ?? snapshot.load.total + (currentSession && q?.status !== "NOT_JOINED" ? 1 : 0);
    const previous = previousSample.current;
    const shouldSample = !previous || now - previous.at >= 900;
    const sampleSeconds = previous ? Math.max(0.001, (now - previous.at) / 1000) : 1;
    if (shouldSample) previousSample.current = { at: now, admitted, arrivals };
    setLive((old) => {
      const elapsed = old.elapsed + (shouldSample ? 1 : 0);
      const resources = snapshot.inventory.map((unit, index) => {
        const mine = unit.heldByYou || (unit.unitId === q?.heldUnitId && unit.status.toUpperCase() === "HELD");
        const status = unit.status.toUpperCase() === "CONFIRMED" ? "confirmed"
          : mine ? "mine" : unit.status.toUpperCase() === "HELD" ? "held" : "available";
        return {
          id: index + 1, unitId: unit.unitId, status,
          expiresAt: unit.leaseRemainingSeconds > 0 ? now + unit.leaseRemainingSeconds * 1000 : 0,
          progress: 0,
          owner: mine ? currentSession?.name ?? "You" : status === "available" ? "" : "Someone else",
        } as State["resources"][number];
      });
      const phase = detached.current ? old.phase : participantPhase(q, a, old);
      const result: State = {
        ...old, scenario: expectedFlow, mode: "live", backendStatus: "online", error: undefined,
        catalog: { ...catalog.current, [expectedFlow]: { name: snapshot.name, capacity: snapshot.totalUnits, resourcePrefix: snapshot.resourcePrefix } },
        now, lastUpdatedAt: snapshot.sampledAt ? Date.parse(snapshot.sampledAt) : now, connected: !detached.current,
        running: snapshot.load.running, demand: snapshot.load.running && snapshot.load.total > 0 ? snapshot.load.total : old.demand,
        fault: snapshot.scenario.mode === "OUTAGE" ? "outage" : snapshot.scenario.mode === "SLOW" ? "slow" : "healthy",
        adaptive: snapshot.policy.adaptive, maxActive: snapshot.policy.maxConcurrent,
        configuredRate: snapshot.policy.admissionRate,
        holdSeconds: snapshot.policy.holdSeconds, rate: snapshot.metrics.admissionRatePerSec,
        latency: Math.round(snapshot.metrics.observedLatencyMs),
        waiting: snapshot.metrics.queueLength, arrivals, admitted, recycled: snapshot.metrics.recycled,
        resources, phase,
        position: detached.current ? old.position : q?.position ?? 0,
        participantName: currentSession?.name ?? old.participantName,
        participantId: currentSession?.claimantId ?? "Not joined",
        estimatedWaitSeconds: q && q.estimatedWaitSeconds != null && q.estimatedWaitSeconds >= 0 ? q.estimatedWaitSeconds : null,
        queueStatus: q?.status,
        receipt: a ? String(a.allocationId ?? a.id ?? "Confirmed") : old.receipt,
        elapsed,
        events: snapshot.events.map((entry) => ({ id: entry.id, time: typeof entry.at === "number" ? entry.at : Date.parse(entry.at), kind: eventKind(entry.type), text: entry.message })),
        history: shouldSample ? [...old.history, {
          second: elapsed,
          arrivals: previous ? Math.round(Math.max(0, arrivals - previous.arrivals) / sampleSeconds * 100) / 100 : 0,
          admission: previous ? Math.round(Math.max(0, admitted - previous.admitted) / sampleSeconds * 100) / 100 : 0,
          latency: snapshot.scenario.mode === "OUTAGE" || snapshot.metrics.observedLatencyMs <= 0 ? null : snapshot.metrics.observedLatencyMs,
          active: snapshot.metrics.activeCheckouts,
        }].slice(-60) : old.history,
      };
      return result;
    });
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    activeFlow.current = flow;
    session.current = loadSession(flow);
    queue.current = null;
    lastQueueEventAt.current = 0;
    allocation.current = null;
    latest.current = null;
    previousSample.current = null;
    detached.current = false;
    setLive(blank(flow));
    let cancelled = false;
    let polling = false;
    void request<FlowMetadata[]>("/api/flows").then((flows) => {
      if (cancelled || !Array.isArray(flows)) return;
      catalog.current = Object.fromEntries(flows.map((item) => [item.id, { name: item.name, capacity: item.totalUnits, resourcePrefix: item.resourcePrefix }]));
      setLive((old) => ({ ...old, catalog: catalog.current }));
    }).catch(() => { /* The active flow snapshot can still be loaded independently. */ });
    async function refresh() {
      if (cancelled || polling) return;
      polling = true;
      try {
        const identity = session.current;
        if (identity && !detached.current) {
          // Healthy SSE supplies queue state. Poll only when its events are stale.
          if (!queue.current || Date.now() - lastQueueEventAt.current > 3000) {
            const status = await request<QueueStatus>(`/api/waiting-room/${flow}/status${sessionQuery(identity)}`);
            if (cancelled) return;
            queue.current = status;
          }
          if (queue.current?.status === "CONFIRMED" && !allocation.current) {
            const confirmed = await request<Allocation>(`/api/pools/${flow}/allocation${sessionQuery(identity)}`);
            if (cancelled) return;
            allocation.current = confirmed;
          }
        }
        const snapshot = await request<Snapshot>(`/api/flows/${flow}${sessionQuery(identity)}`);
        if (cancelled || !snapshot) return;
        publish(snapshot, flow);
        const status = queue.current;
        if (identity && !detached.current && status?.admitted && status.admissionToken && !status.heldUnitId && !allocation.current && !holding.current && snapshot.scenario.mode !== "OUTAGE") {
          const available = snapshot.inventory.find((unit) => unit.status.toUpperCase() === "AVAILABLE");
          if (available) {
            holding.current = true;
            try {
              const claim = await request<Claim>(`/api/pools/${flow}/hold${sessionQuery(identity)}`, "POST", {
                unitId: available.unitId, claimantId: identity.claimantId, admissionToken: status.admissionToken,
              });
              if (cancelled) return;
              if (claim?.success) {
                queue.current = { ...status, heldUnitId: claim.unitId, holdRemainingSeconds: claim.leaseTtlSeconds ?? snapshot.policy.holdSeconds };
                const updated = await request<Snapshot>(`/api/flows/${flow}${sessionQuery(identity)}`);
                if (!cancelled && updated) publish(updated, flow);
              }
            } catch (error) {
              // A competing participant may win the unit. Retry from the next server snapshot.
              if (!(error instanceof ApiError && error.status === 409)) throw error;
            } finally { holding.current = false; }
          }
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          session.current = null;
          queue.current = null;
          save(sessionKey(flow), "null");
          setLive((old) => ({ ...old, phase: "ready", participantId: "Not joined", pending: false, notice: "Your queue pass has expired. Join again to get a fresh one." }));
        } else {
          setLive((old) => ({ ...old, backendStatus: "offline", connected: false, error: "We can’t reach the queue right now. You’re seeing the last update. Please reconnect before claiming a spot." }));
        }
      } finally { polling = false; }
    }
    pollNow.current = refresh;
    void refresh();
    const poll = setInterval(() => void refresh(), 1000);
    const clock = setInterval(() => setLive((old) => ({ ...old, now: Date.now() })), 250);
    return () => { cancelled = true; clearInterval(poll); clearInterval(clock); };
  }, [flow, mode, publish]);

  useEffect(() => {
    if (mode !== "live" || !session.current || detached.current) return;
    const identity = session.current;
    const source = new EventSource(`/api/waiting-room/${flow}/stream${sessionQuery(identity)}`);
    source.onopen = () => setLive((old) => ({ ...old, streamStatus: "open" }));
    source.onerror = () => setLive((old) => ({ ...old, streamStatus: "reconnecting" }));
    source.addEventListener("QUEUE_UPDATE", (event) => {
      try {
        queue.current = JSON.parse((event as MessageEvent).data) as QueueStatus;
        lastQueueEventAt.current = Date.now();
        void pollNow.current();
      } catch { /* Polling remains authoritative if an event cannot be decoded. */ }
    });
    return () => source.close();
  }, [flow, mode, connectionRevision]);

  const dispatch = useCallback((action: Action) => {
    if (action.type === "mode") {
      save(MODE_KEY, action.mode);
      setMode(action.mode);
      return;
    }
    if (mode === "simulation") { simulation.dispatch(action); return; }
    if (action.type === "scenario") {
      save(FLOW_KEY, action.scenario);
      activeFlow.current = action.scenario;
      setFlow(action.scenario);
      return;
    }
    if (action.type === "retry") { void pollNow.current(); return; }
    if (action.type === "dismiss") { setLive((old) => ({ ...old, notice: "" })); return; }
    if (action.type === "tick") return;
    if (action.type === "connection") {
      // A real transport failure already interrupts updates; reconnecting it must
      // never accidentally turn on the deliberate disconnect experiment.
      detached.current = !(detached.current || !liveRef.current.connected);
      setLive((old) => ({ ...old, connected: !detached.current, streamStatus: detached.current ? "paused" : "connecting", notice: detached.current ? "Your updates are paused. Your place stays in line, and your spot’s timer still runs." : "Reconnecting to find your latest place in line." }));
      setConnectionRevision((value) => value + 1);
      if (!detached.current) void pollNow.current();
      return;
    }
    if (action.type === "recycle") {
      void pollNow.current();
      setLive((old) => ({ ...old, notice: "Spots come back when their timers end. Everyone else keeps their saved place." }));
      return;
    }
    if (action.type === "reset") {
      previousSample.current = null;
      setLive((old) => ({ ...old, history: [], elapsed: 0, notice: "Fresh chart, same queue. Everyone’s place and confirmed spots stay saved." }));
      return;
    }
    if (busy.current) return;
    const actionFlow = flow;
    const update = (change: Partial<State>) => {
      if (activeFlow.current === actionFlow) setLive((old) => ({ ...old, ...change }));
    };
    busy.current = true;
    update({ pending: true, notice: "" });
    void (async () => {
      try {
        const current = liveRef.current;
        if (action.type === "join") {
          if (!action.name.trim()) return;
          if (!session.current) {
            const created = await request<Session>(`/api/flows/${flow}/sessions`, "POST");
            if (!created) throw new Error("The server did not issue a participant session.");
            session.current = created;
          }
          session.current.name = action.name.trim().slice(0, 60);
          save(sessionKey(flow), JSON.stringify(session.current));
          queue.current = await request<QueueStatus>(`/api/waiting-room/${flow}/join${sessionQuery(session.current)}`, "POST");
          allocation.current = null;
          detached.current = false;
          update({ participantName: session.current.name, participantId: session.current.claimantId, phase: "queued", position: queue.current?.position ?? 0 });
          setConnectionRevision((value) => value + 1);
        } else if (action.type === "confirm") {
          const identity = session.current;
          const mine = current.resources.find((unit) => unit.status === "mine");
          if (!identity || !mine || detached.current) throw new Error("Reconnect and wait for a valid server reservation before confirming.");
          const response = await request<Claim>(`/api/pools/${flow}/confirm${sessionQuery(identity)}`, "POST", {
            unitId: mine.unitId, claimantId: identity.claimantId, admissionToken: queue.current?.admissionToken,
          });
          if (response?.success) allocation.current = { allocationId: response.allocationId, unitId: response.unitId };
        } else if (action.type === "leave") {
          const identity = session.current;
          if (identity) {
            const mine = current.resources.find((unit) => unit.status === "mine");
            if (mine) await request(`/api/pools/${flow}/release${sessionQuery(identity)}`, "POST", { unitId: mine.unitId, claimantId: identity.claimantId, admissionToken: queue.current?.admissionToken });
            await request(`/api/waiting-room/${flow}/leave${sessionQuery(identity)}`, "POST");
          }
          queue.current = null;
          update({ phase: "ready", position: 0, notice: "You’ve left the line. Your spot is available to someone else now." });
        } else if (action.type === "fault") {
          await request(`/api/flows/${flow}/scenario`, "POST", { mode: action.fault === "outage" ? "OUTAGE" : action.fault === "slow" ? "SLOW" : "NORMAL" });
        } else if (action.type === "settings") {
          await request(`/api/flows/${flow}/policy`, "PUT", { maxConcurrent: action.maxActive, admissionRate: action.admissionRate ?? latest.current?.policy.admissionRate ?? 4, holdSeconds: action.holdSeconds, adaptive: action.adaptive });
          update({ demand: action.demand, notice: "Queue settings saved. Existing spot timers stay the same." });
        } else if (action.type === "start") {
          await request(`/api/flows/${flow}/load`, "POST", { buyers: current.demand });
          update({ notice: "Here comes the test crowd. Watch the line move!" });
        } else if (action.type === "pause") {
          await request(`/api/flows/${flow}/load/stop`, "POST");
          update({ notice: "The test crowd is stopping. Your own place stays saved." });
        }
        await pollNow.current();
      } catch (error) {
        update({ notice: friendlyProblem(error, action.type), ...(error instanceof ApiError ? {} : { backendStatus: "offline" as const }) });
        await pollNow.current();
      } finally { busy.current = false; update({ pending: false }); }
    })();
  }, [flow, mode, simulation.dispatch]);

  // The simulation's data and credentials never cross into the live engine.
  return { state: mode === "simulation" ? { ...simulation.state, mode: "simulation" as const } : live, dispatch };
}
