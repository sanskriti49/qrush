import { useEffect, useReducer } from "react";

export type ScenarioId = "hackathon" | "product" | "workshop";
export type Fault = "healthy" | "slow" | "outage";
export type Phase = "ready" | "queued" | "admitted" | "confirmed" | "expired";
export type Resource = {
  id: number;
  unitId?: string;
  status: "available" | "held" | "confirmed" | "mine";
  expiresAt: number;
  progress: number;
  owner: string;
};
export type Event = {
  id: string;
  time: number;
  kind: "admit" | "confirm" | "recycle" | "control" | "info";
  text: string;
};
export type Sample = {
  second: number;
  arrivals: number;
  admission: number;
  latency: number | null;
  active: number;
};
export const SCENARIOS = {
  hackathon: {
    name: "HackSprint ’26",
    category: "Hackathon registration",
    capacity: 100,
    resource: "places",
    singular: "place",
    action: "Confirm registration",
    accent: "Code. Create. Come together.",
    code: "HSP",
    description: "A weekend for big ideas. A fair place for every builder.",
    detail: "28–29 November · Bengaluru · 24 hours",
  },
  product: {
    name: "Studio / 001",
    category: "Limited product release",
    capacity: 60,
    resource: "units",
    singular: "unit",
    action: "Confirm demo order",
    accent: "Small batch. Big demand.",
    code: "STU",
    description:
      "A limited release. One unit per participant, fairly allocated.",
    detail: "Edition 001 · One item per participant · Mock checkout",
  },
  workshop: {
    name: "Make Something",
    category: "Workshop booking",
    capacity: 40,
    resource: "spots",
    singular: "spot",
    action: "Confirm booking",
    accent: "Learn by making.",
    code: "MKS",
    description: "A small creative workshop with space for curious minds.",
    detail: "5 December · Online · One spot per participant",
  },
} as const;
export type State = {
  version: 2;
  mode: "live" | "simulation";
  backendStatus: "checking" | "online" | "offline";
  pending: boolean;
  lastUpdatedAt: number;
  estimatedWaitSeconds?: number | null;
  queueStatus?: string;
  streamStatus?: "connecting" | "open" | "reconnecting" | "paused";
  error?: string;
  configuredRate?: number;
  catalog?: Partial<Record<ScenarioId, { name: string; capacity: number; resourcePrefix: string }>>;
  scenario: ScenarioId;
  now: number;
  running: boolean;
  fault: Fault;
  adaptive: boolean;
  demand: number;
  arrivals: number;
  waiting: number;
  maxActive: number;
  rate: number;
  holdSeconds: number;
  latency: number;
  elapsed: number;
  resources: Resource[];
  phase: Phase;
  position: number;
  participantName: string;
  participantId: string;
  connected: boolean;
  receipt: string;
  admitted: number;
  recycled: number;
  history: Sample[];
  events: Event[];
  notice: string;
};
export function scenarioDetails(state: State, id: ScenarioId = state.scenario) {
  return { ...SCENARIOS[id], ...state.catalog?.[id] };
}
export const duration = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
export const counts = (state: State) => ({
  available: state.resources.filter((r) => r.status === "available").length,
  held: state.resources.filter(
    (r) => r.status === "held" || r.status === "mine",
  ).length,
  confirmed: state.resources.filter((r) => r.status === "confirmed").length,
});
export function initial(scenario: ScenarioId = "hackathon"): State {
  const now = Date.now();
  return {
    version: 2,
    mode: "simulation",
    backendStatus: "checking",
    pending: false,
    lastUpdatedAt: 0,
    scenario,
    now,
    running: false,
    fault: "healthy",
    adaptive: true,
    demand: 500,
    arrivals: 0,
    waiting: 0,
    maxActive: 10,
    rate: 4,
    configuredRate: 4,
    holdSeconds: 120,
    latency: 180,
    elapsed: 0,
    resources: Array.from({ length: SCENARIOS[scenario].capacity }, (_, i) => ({
      id: i + 1,
      status: "available",
      expiresAt: 0,
      progress: 0,
      owner: "",
    })),
    phase: "ready",
    position: 0,
    participantName: "",
    participantId: `Q-${now.toString(36).slice(-5).toUpperCase()}`,
    connected: true,
    receipt: "",
    admitted: 0,
    recycled: 0,
    history: [],
    notice: "",
    events: [
      {
        id: `init-${now}`,
        time: now,
        kind: "info",
        text: `${SCENARIOS[scenario].name} is ready. All values are a local simulation.`,
      },
    ],
  };
}
export type Action =
  | { type: "mode"; mode: "live" | "simulation" }
  | { type: "retry" }
  | {
      type:
        | "tick"
        | "start"
        | "pause"
        | "confirm"
        | "leave"
        | "recycle"
        | "dismiss"
        | "connection"
        | "reset";
    }
  | { type: "fault"; fault: Fault }
  | { type: "scenario"; scenario: ScenarioId }
  | { type: "join"; name: string }
  | {
      type: "settings";
      demand: number;
      maxActive: number;
      holdSeconds: number;
      adaptive: boolean;
      admissionRate?: number;
    };
function event(
  state: State,
  text: string,
  kind: Event["kind"] = "info",
): Event[] {
  const time = Date.now();
  return [
    {
      id: `${time}-${state.elapsed}-${state.events.length}-${kind}`,
      time,
      kind,
      text,
    },
    ...state.events,
  ].slice(0, 100);
}
function active(state: State) {
  return counts(state).held;
}
function hasClosed(state: State) {
  const c = counts(state);
  return c.available === 0 && c.held === 0;
}

export function reducer(state: State, action: Action): State {
  const now = Date.now();
  switch (action.type) {
    case "mode":
    case "retry":
      return state;
    case "tick": {
      let next = {
        ...state,
        now,
        resources: state.resources.map((r) => ({ ...r })),
      };
      let released = 0;
      let completed = 0;
      next.resources = next.resources.map((r) => {
        if (
          (r.status === "held" || r.status === "mine") &&
          r.expiresAt <= now
        ) {
          released++;
          if (r.status === "mine") next.phase = "expired";
          return {
            ...r,
            status: "available" as const,
            owner: "",
            expiresAt: 0,
            progress: 0,
          };
        }
        if (r.status === "held" && next.running && next.fault !== "outage") {
          const progress = r.progress + (next.fault === "slow" ? 0.2 : 1);
          if (progress >= 4 && Number(r.owner.slice(4)) % 7 !== 0) {
            completed++;
            return {
              ...r,
              progress,
              status: "confirmed" as const,
              expiresAt: 0,
            };
          }
          return { ...r, progress };
        }
        return r;
      });
      next.recycled += released;
      if (released)
        next.events = event(
          next,
          `${released} expired reservation${released === 1 ? "" : "s"} returned to the available pool.`,
          "recycle",
        );
      if (completed)
        next.events = event(
          next,
          `${completed} simulated registration${completed === 1 ? "" : "s"} confirmed.`,
          "confirm",
        );

      const targetRate =
        next.fault === "outage"
          ? 0
          : next.adaptive && next.fault === "slow"
            ? Math.max(1, Math.floor((next.configuredRate ?? 4) / 5))
            : next.configuredRate ?? 4;
      if (next.fault === "outage") next.rate = 0;
      else if (next.rate > targetRate)
        next.rate = Math.max(targetRate, next.rate - 1);
      else if (next.rate < targetRate && next.elapsed % 2 === 0) next.rate++;
      const targetLatency =
        next.fault === "slow"
          ? 1400 + active(next) * 55
          : 180 + active(next) * 14;
      next.latency = Math.round(next.latency * 0.4 + targetLatency * 0.6);
      let arriving = 0;
      let admissions = 0;
      const shouldAdvance = next.running || next.phase === "queued";
      if (shouldAdvance) {
        next.elapsed++;
        if (next.running && !hasClosed(next)) {
          arriving = Math.min(
            next.demand - next.arrivals,
            Math.max(
              1,
              Math.round(
                (next.demand / 12) * (0.8 + Math.sin(next.elapsed * 0.8) * 0.2),
              ),
            ),
          );
          next.arrivals += arriving;
          next.waiting += arriving;
        }
        const permits =
          next.fault === "outage"
            ? 0
            : Math.max(
                0,
                Math.min(
                  next.rate,
                  next.maxActive - active(next),
                  counts(next).available,
                  next.waiting,
                ),
              );
        for (let i = 0; i < permits; i++) {
          const resource = next.resources.find((r) => r.status === "available");
          if (!resource) break;
          if (next.phase === "queued" && next.position === 1) {
            resource.status = "mine";
            resource.owner = next.participantId;
            resource.expiresAt = now + next.holdSeconds * 1000;
            next.phase = "admitted";
            next.position = 0;
            next.events = event(
              next,
              `${next.participantId} admitted. Resource #${resource.id} reserved for ${next.holdSeconds}s.`,
              "admit",
            );
          } else {
            resource.status = "held";
            resource.owner = `SIM-${next.admitted + 1}`;
            resource.expiresAt =
              now +
              ((next.admitted + 1) % 7 === 0 ? 12000 : next.holdSeconds * 1000);
            resource.progress = 0;
            if (next.phase === "queued")
              next.position = Math.max(1, next.position - 1);
          }
          admissions++;
          next.admitted++;
          next.waiting--;
        }
        if (admissions && next.phase !== "admitted")
          next.events = event(
            next,
            `${admissions} participant${admissions === 1 ? "" : "s"} admitted. ${active(next)} of ${next.maxActive} concurrent reservations in use.`,
            "admit",
          );
        next.history = [
          ...next.history,
          {
            second: next.elapsed,
            arrivals: arriving,
            admission: admissions,
            latency: next.fault === "outage" ? null : next.latency,
            active: active(next),
          },
        ].slice(-60);
      }
      if (next.rate !== state.rate)
        next.events = event(
          next,
          `Admission adjusted ${state.rate} → ${next.rate}/s. ${next.fault === "outage" ? "Backend unavailable; new admissions paused." : next.fault === "slow" ? "Slowdown detected; reducing pressure." : "Capacity recovered; increasing gradually."}`,
          "control",
        );
      return next;
    }
    case "start":
      return {
        ...state,
        running: true,
        notice: "",
        events: event(
          state,
          `Simulation ${state.arrivals ? "resumed" : "started"}: up to ${state.demand} virtual participants.`,
          "control",
        ),
      };
    case "pause":
      return {
        ...state,
        running: false,
        notice:
          "The test crowd is paused. Your place can still move, and spot timers keep running.",
        events: event(
          state,
          "Virtual arrivals and automated confirmations paused. Lease expiry continues.",
          "control",
        ),
      };
    case "fault":
      return {
        ...state,
        fault: action.fault,
        rate: action.fault === "outage" ? 0 : state.rate,
        events: event(
          state,
          action.fault === "healthy"
            ? "Backend restored. Admission will recover gradually."
            : action.fault === "slow"
              ? "Injected 5× processing slowdown. Adaptive admission is responding."
              : "Injected backend outage. New admissions and confirmations are paused.",
          "control",
        ),
      };
    case "scenario":
      return initial(action.scenario);
    case "join": {
      if (
        !["ready", "expired"].includes(state.phase) ||
        !action.name.trim() ||
        hasClosed(state)
      )
        return state;
      return {
        ...state,
        now,
        phase: "queued",
        position: state.waiting + 1,
        waiting: state.waiting + 1,
        participantName: action.name.trim().slice(0, 60),
        connected: true,
        notice: "",
        events: event(
          state,
          `${state.participantId} joined at position #${state.waiting + 1}.`,
          "info",
        ),
      };
    }
    case "confirm": {
      const mine = state.resources.find((r) => r.status === "mine");
      if (
        !mine ||
        state.phase !== "admitted" ||
        mine.expiresAt <= now ||
        state.fault === "outage" ||
        !state.connected
      )
        return state;
      const receipt = `${SCENARIOS[state.scenario].code}-${state.participantId.slice(2)}-${mine.id.toString().padStart(3, "0")}`;
      return {
        ...state,
        phase: "confirmed",
        receipt,
        resources: state.resources.map((r) =>
          r.status === "mine" ? { ...r, status: "confirmed", expiresAt: 0 } : r,
        ),
        events: event(
          state,
          `Demo confirmation ${receipt} issued once.`,
          "confirm",
        ),
        notice: "",
      };
    }
    case "leave":
      return {
        ...state,
        phase: "ready",
        position: 0,
        waiting: Math.max(
          0,
          state.waiting - (state.phase === "queued" ? 1 : 0),
        ),
        resources: state.resources.map((r) =>
          r.status === "mine"
            ? { ...r, status: "available", owner: "", expiresAt: 0 }
            : r,
        ),
        notice:
          "You’ve left the line. You can join again if there are spots left.",
      };
    case "recycle": {
      const released = state.resources.filter(
        (r) => r.status === "held",
      ).length;
      return {
        ...state,
        recycled: state.recycled + released,
        resources: state.resources.map((r) =>
          r.status === "held"
            ? {
                ...r,
                status: "available",
                owner: "",
                expiresAt: 0,
                progress: 0,
              }
            : r,
        ),
        notice: `${released} practice spots are available again. Your spot is still saved.`,
        events: event(
          state,
          `${released} simulated abandoned holds recycled.`,
          "recycle",
        ),
      };
    }
    case "connection":
      return {
        ...state,
        connected: !state.connected,
        notice: state.connected
          ? "Your practice updates are paused. Your place stays saved."
          : "You’re connected again. Here’s your latest place in line.",
        events: event(
          state,
          `${state.participantId} ${state.connected ? "disconnected; identity retained" : "reconnected with the same identity"}.`,
        ),
      };
    case "settings": {
      if (
        ![100, 500, 1000].includes(action.demand) ||
        ![5, 10, 20].includes(action.maxActive) ||
        action.maxActive < active(state) ||
        ![30, 60, 120, 300].includes(action.holdSeconds) ||
        (action.admissionRate !== undefined && (!Number.isInteger(action.admissionRate) || action.admissionRate < 1 || action.admissionRate > 50)) ||
        action.demand < state.arrivals
      )
        return state;
      return {
        ...state,
        demand: action.demand,
        maxActive: action.maxActive,
        holdSeconds: action.holdSeconds,
        adaptive: action.adaptive,
        configuredRate: action.admissionRate ?? state.configuredRate ?? 4,
        events: event(
          state,
          `Policy updated: ${action.maxActive} active reservations, ${action.holdSeconds}s leases, ${action.adaptive ? "adaptive" : "fixed"} admission. Existing lease deadlines stay unchanged.`,
          "control",
        ),
        notice:
          "Queue settings saved. Existing spot timers stay the same.",
      };
    }
    case "dismiss":
      return { ...state, notice: "" };
    case "reset":
      return initial(state.scenario);
  }
}
const STORAGE = "qrush-workspace-v2";
function restore(): State {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(STORAGE) ?? "null",
    ) as State | null;
    if (
      saved?.version === 2 &&
      saved.scenario in SCENARIOS &&
      Array.isArray(saved.resources) &&
      saved.resources.length === SCENARIOS[saved.scenario].capacity &&
      Array.isArray(saved.events) &&
      Array.isArray(saved.history) &&
      ["ready", "queued", "admitted", "confirmed", "expired"].includes(
        saved.phase,
      ) &&
      ["healthy", "slow", "outage"].includes(saved.fault)
    ) {
      const paused = { ...saved, running: false, connected: true };
      // Reconcile lease deadlines before the refreshed UI can offer confirmation.
      return reducer(paused, { type: "tick" });
    }
  } catch {
    /* A private-browser storage restriction must not break the workspace. */
  }
  return initial();
}
export function useSimulationWorkspace(enabled = true) {
  const [state, dispatch] = useReducer(reducer, undefined, restore);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE, JSON.stringify(state));
    } catch {
      /* Persistence is optional. */
    }
  }, [state]);
  return { state, dispatch };
}
