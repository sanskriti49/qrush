import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Cpu,
  FlaskConical,
  Gauge,
  GitBranch,
  GraduationCap,
  Info,
  LayoutDashboard,
  Menu,
  Package,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Timer,
  Unplug,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  counts,
  duration,
  SCENARIOS,
  scenarioDetails,
  type State,
  type Action,
  type Resource,
  type ScenarioId,
} from "./workspaceEngine";
import { useWorkspace } from "./liveWorkspace";
import type { Dispatch } from "react";
import { Modal } from "./Modal";
import { activityCopy, activityLabels, activitySignal, noticeCopy } from "./uiCopy";
import { AnimatedNumber, useActivityMotion, useJourneyMotion, useQueueMotion, useSceneMotion, useSpotMotion } from "./motion";

const AdmissionChart = lazy(() => import("./AdmissionChart"));
type View = "overview" | "participant" | "chaos" | "activity";
type Actions = Dispatch<Action>;
const VIEW_NAMES = {
  overview: "Overview",
  participant: "Join the queue",
  chaos: "Playground",
  activity: "What’s happening",
};
const readView = (): View => {
  const hash = location.hash.slice(1);
  return hash in VIEW_NAMES ? (hash as View) : "overview";
};
const time = (value: number) =>
  new Date(value).toLocaleTimeString("en-GB", { hour12: false });
const num = (value: number) => value.toLocaleString("en-IN");
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

function Pill({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`w-pill ${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Heading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading w-heading">
      <div>
        <div className="eyebrow heading-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function FlowPicker({
  state,
  change,
}: {
  state: State;
  change: (scenario: ScenarioId) => void;
}) {
  return (
    <div className="flow-picker" role="group" aria-label="Choose a queue">
      {(
        Object.entries(SCENARIOS) as [
          ScenarioId,
          (typeof SCENARIOS)[ScenarioId],
        ][]
      ).map(([id]) => {
        const scenario = scenarioDetails(state, id);
        return (
        <button
          key={id}
          className={state.scenario === id ? "selected" : ""}
          disabled={state.pending}
          aria-pressed={state.scenario === id}
          onClick={() => change(id)}
        >
          <span className={`flow-type-icon ${id}`}>
            {id === "hackathon" ? (
              <Code2 size={17} />
            ) : id === "product" ? (
              <Package size={17} />
            ) : (
              <GraduationCap size={17} />
            )}
          </span>
          <span>
            <strong>{scenario.name}</strong>
            <small>{scenario.category}</small>
          </span>
          <span className="flow-capacity">
            {scenario.capacity}
            <small>{scenario.resource}</small>
          </span>
          {state.scenario === id && <Check size={14} />}
        </button>
        );
      })}
    </div>
  );
}
function RunButton({ state, dispatch }: { state: State; dispatch: Actions }) {
  return (
    <button
      className={`button ${state.running ? "secondary" : "primary"}`}
      disabled={state.pending || (state.mode === "live" && state.backendStatus !== "online")}
      onClick={() => dispatch({ type: state.running ? "pause" : "start" })}
    >
      {state.running ? (
        <Pause size={14} />
      ) : (
        <Play size={14} fill="currentColor" />
      )}
      {state.running
        ? state.mode === "live" ? "Stop test crowd" : "Pause test crowd"
        : state.mode === "live"
          ? "Send test crowd"
        : state.arrivals
          ? "Resume practice run"
          : "Start practice run"}
    </button>
  );
}
function Pipeline({
  state,
  participant,
}: {
  state: State;
  participant: () => void;
}) {
  const c = counts(state);
  const slowed = state.fault !== "healthy";
  const pipeline = useRef<HTMLElement>(null);
  useQueueMotion(pipeline, state.running || state.waiting > 0 || c.held > 0, state.fault);
  return (
    <section
      ref={pipeline}
      className={`pipeline-card ${state.running ? "is-running" : ""} ${state.fault}`}
    >
      <div className="pipeline-top">
        <div>
          <span className="eyebrow">THE LINE, RIGHT NOW</span>
          <h2>From first click <span>to confirmed.</span></h2>
          <p>People wait here while a few reserve their spots. Nobody has to guess what’s left.</p>
        </div>
        <div className="gate-status">
          <span className="gate-icon">
            <ShieldCheck size={26} />
          </span>
          <Pill
            tone={state.fault === "outage" ? "red" : slowed ? "amber" : "green"}
          >
            {state.fault === "outage"
              ? "GATE PAUSED"
              : slowed
                ? "TAKING IT SLOW"
                : "GATE OPEN"}
          </Pill>
          <small>
            {state.adaptive ? "Auto-adjusting" : "Fixed speed"} · {state.mode === "live" ? "live queue" : "practice queue"}
          </small>
        </div>
      </div>
      <div className="pipeline-track" aria-label="How the queue moves">
        <div className="pipeline-node">
          <span className="node-icon">
            <Users size={17} />
          </span>
          <div>
            <span>People arrived</span>
            <strong>
              <AnimatedNumber value={state.arrivals} />
            </strong>
          </div>
        </div>
        <span className="pipeline-wire">
          <i />
          <ChevronRight size={13} />
        </span>
        <button className="pipeline-node queue-node" onClick={participant}>
          <span className="node-icon">
            <GitBranch size={17} />
          </span>
          <div>
          <span>Waiting their turn</span>
            <strong><AnimatedNumber value={state.waiting} /></strong>
          </div>
          <ArrowUpRight size={13} />
        </button>
        <span className="pipeline-wire">
          <i />
          <ChevronRight size={13} />
        </span>
        <div className="pipeline-node">
          <span className="node-icon">
            <Cpu size={17} />
          </span>
          <div>
            <span>Reserved right now</span>
            <strong>
              <AnimatedNumber value={c.held} />
              <small> / {state.maxActive}</small>
            </strong>
          </div>
        </div>
        <span className="pipeline-wire">
          <i />
          <ChevronRight size={13} />
        </span>
        <div className="pipeline-node confirmed-node">
          <span className="node-icon">
            <CheckCheck size={17} />
          </span>
          <div>
            <span>Confirmed</span>
            <strong><AnimatedNumber value={c.confirmed} /></strong>
          </div>
        </div>
      </div>
      <div className="pipeline-foot">
        <span>
          <i className="status-dot" />
          {scenarioDetails(state).name}
          <span className="pipe-separator">/</span>
          {scenarioDetails(state).category}
        </span>
        <span>
          Up to {state.rate} people / sec{" "}
          <span className="pipe-separator">·</span>{" "}
          {duration(state.holdSeconds)} to claim a spot
        </span>
      </div>
    </section>
  );
}
function Metrics({ state }: { state: State }) {
  const c = counts(state);
  return (
    <div className="w-metrics">
      {[
        {
          label: "People waiting",
          value: state.waiting,
          suffix: "people",
          icon: Users,
          detail:
            state.phase === "queued"
              ? `Your place: #${state.position}`
              : "Everyone joins at the back",
          tone: "",
        },
        {
          label: "Entry speed",
          value: state.rate,
          suffix: "/ second",
          icon: Gauge,
          detail:
            state.fault === "outage"
              ? "New entries are paused"
              : state.fault === "slow" && state.adaptive
                ? "Slower entry keeps things moving"
                : `Up to ${state.maxActive} people can choose at once`,
          tone: state.fault === "healthy" ? "" : "amber",
        },
        {
          label: "Spots left",
          value: c.available,
          suffix: `/ ${state.resources.length}`,
          icon: Package,
          detail: `${c.held} saved · ${c.confirmed} confirmed`,
          tone: "",
        },
        {
          label: state.mode === "live" ? "Time to confirm" : "Practice response time",
          value: state.fault === "outage" || (state.mode === "live" && state.latency === 0) ? "—" : state.latency < 10 ? "<0.01" : (state.latency / 1000).toFixed(2),
          suffix: state.fault === "outage" ? "paused" : state.mode === "live" && state.latency === 0 ? "not yet" : "sec",
          icon: Activity,
          detail: state.mode === "live" ? state.latency === 0 ? "A time appears after someone confirms" : "Based on recent confirmations" : "An example for this practice run",
          tone: state.fault !== "healthy" ? "amber" : "",
        },
      ].map(({ label, value, suffix, icon: Icon, detail, tone }) => (
        <article className={`metric-card panel ${tone}`} key={label}>
          <div>
            <span>{label}</span>
            <Icon size={16} />
          </div>
          <strong>
            {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
            <small>{suffix}</small>
          </strong>
          <span className="micro">{detail}</span>
        </article>
      ))}
    </div>
  );
}
function ResponseChart({ state }: { state: State }) {
  return (
    <section className="panel response-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE LAST 60 SECONDS</span>
          <h2>Watch the queue move.</h2>
          <p>Compare how fast people enter with how long confirmation takes.</p>
        </div>
        <span className="chart-range">LAST 60 SECONDS</span>
      </div>
      <div className="response-legend">
        <span>
          <i />
          People entering / sec
        </span>
        <span>
          <i />
          {state.mode === "live" ? "Confirmation time" : "Practice response time"}
        </span>
        <small>{state.mode === "live" ? "LATEST UPDATES" : "SIMULATED"}</small>
      </div>
      <div className="response-chart">
        {state.history.length ? (
          <Suspense
            fallback={
              <div className="w-chart-empty">Preparing your chart…</div>
            }
          >
            <AdmissionChart history={state.history} />
          </Suspense>
        ) : (
          <div className="w-chart-empty">
            <div className="empty-wave" aria-hidden="true">
              {Array.from({ length: 35 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    height: `${14 + Math.sin(i * 0.6) * 10 + (i > 9 && i < 24 ? 19 : 0)}px`,
                  }}
                />
              ))}
            </div>
            <strong>Ready for a little rush?</strong>
            <span>{state.mode === "live" ? "New readings will appear here." : "Send a test crowd to wake up the chart."}</span>
          </div>
        )}
      </div>
      <div className="chart-foot">
        <ShieldCheck size={15} />
        People enter only when there are free spots and room to reserve.
      </div>
    </section>
  );
}
function FaultControls({
  state,
  dispatch,
  settings,
}: {
  state: State;
  dispatch: Actions;
  settings: () => void;
}) {
  return (
    <section className="panel fault-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">TRY A PLOT TWIST</span>
          <h2>What if things slow down?</h2>
        </div>
        <FlaskConical size={18} />
      </div>
      <p className="fault-description">
        Slow confirmations or pause entry. Watch QRush adjust the pace.
      </p>
      <div
        className="fault-options"
        role="group"
        aria-label="Queue mood"
      >
        {(
          [
            {
              id: "healthy",
              icon: Radio,
              label: "All good",
              detail: "Let things run",
            },
            {
              id: "slow",
              icon: Timer,
              label: "Slow down",
              detail: state.mode === "live" ? "+1 sec to confirm" : "5× processing time",
            },
            {
              id: "outage",
              icon: Unplug,
              label: "Pause entry",
              detail: "Stop new entries",
            },
          ] as const
        ).map(({ id, icon: Icon, label, detail }) => (
          <button
            key={id}
            className={state.fault === id ? `selected ${id}` : ""}
            aria-label={
              id === "slow"
                ? "Slow things down"
                : id === "outage"
                  ? "Pause new entries"
                  : "Back to normal"
            }
            aria-pressed={state.fault === id}
            disabled={state.pending || (state.mode === "live" && state.backendStatus !== "online")}
            onClick={() => dispatch({ type: "fault", fault: id })}
          >
            <Icon size={18} />
            <strong>{label}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className={`decision-note ${state.fault}`}>
        <span className="decision-icon">
          {state.fault === "outage" ? (
            <Pause size={16} />
          ) : state.fault === "slow" ? (
            <ArrowDown size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
        </span>
        <div>
          <strong>
            {state.fault === "outage"
              ? "The line is paused."
              : state.fault === "slow"
                ? state.adaptive
                  ? "The gate is slowing down."
                  : "Entry speed is fixed."
                : state.rate < (state.configuredRate ?? 4)
                  ? "Picking up the pace."
                  : "The gate is open."}
          </strong>
          <p>
            {state.fault === "outage"
              ? "Nobody new can enter or confirm right now. Your place in line stays saved, but saved-spot timers still run."
              : state.fault === "slow"
                ? state.adaptive
                  ? state.mode === "live" ? "Confirming takes an extra second. With auto-adjust on, fewer people enter at once." : "In this practice run, things take five times longer, so just one person enters each second."
                  : `Entry stays at ${state.configuredRate ?? 4} people each second. Turn on auto-adjust in Queue settings to let the pace change.`
                : state.rate < (state.configuredRate ?? 4)
                  ? "More people can enter as things get back to normal. The line keeps its order."
                  : `Up to ${state.configuredRate ?? 4} people enter each second. ${state.maxActive} can reserve at once, with ${duration(state.holdSeconds)} to confirm.`}
          </p>
        </div>
      </div>
      <button className="fault-policy" onClick={settings}>
        <SlidersHorizontal size={14} />
        Adjust the pace
        <ArrowUpRight size={14} />
      </button>
    </section>
  );
}
function ResourcePool({
  state,
  inspect,
}: {
  state: State;
  inspect: (resource: Resource) => void;
}) {
  const c = counts(state);
  const [filter, setFilter] = useState("all");
  const grid = useRef<HTMLElement>(null);
  useSpotMotion(grid, state.resources, state.scenario);
  const hasMySpot = state.resources.some((r) => r.status === "mine");
  useEffect(() => setFilter("all"), [state.scenario]);
  useEffect(() => {
    if (!hasMySpot) setFilter((current) => current === "mine" ? "all" : current);
  }, [hasMySpot]);
  const resources = state.resources.filter((r) => filter === "all" || r.status === filter || (filter === "held" && r.status === "mine"));
  return (
    <section ref={grid} className="panel resource-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SPOT CHECK</span>
          <h2>See what’s up for grabs.</h2>
          <p>Each square is one spot. Tap it for its status and timer.</p>
        </div>
        <span className="resource-count">
          {c.available}
          <small> available</small>
        </span>
      </div>
      <div className="resource-filters" role="group" aria-label="Show spots">
        {[["all", "All spots"], ["available", "Available"], ["held", "Reserved"], ["confirmed", "Confirmed"], ...(hasMySpot ? [["mine", "My spot"]] : [])].map(([value, label]) => (
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      <div
        className="resource-dots"
        role="group"
        aria-label="Spot map"
      >
        {resources.map((r) => (
          <button
            key={r.id}
            data-spot={r.id}
            className={`resource-dot ${r.status}`}
            aria-label={`Spot ${r.id}, ${r.status === "mine" ? "your saved spot" : r.status === "held" ? "saved for someone" : r.status}`}
            title={`#${String(r.id).padStart(3, "0")} · ${r.status === "mine" ? "saved for you" : r.status === "held" ? "saved for someone" : r.status}`}
            onClick={() => inspect(r)}
          >
            {r.status === "mine" ? <Check size={9} /> : <span>{r.id}</span>}
          </button>
        ))}
        {!resources.length && <p className="resource-empty">{filter === "all" ? "Waiting for the spot map…" : "No spots in this state right now."}</p>}
      </div>
      <div className="pool-legend">
        <span>
          <i className="available" />
          Available <b>{c.available}</b>
        </span>
        <span>
          <i className="held" />
          Saved <b>{c.held}</b>
        </span>
        <span>
          <i className="confirmed" />
          Confirmed <b>{c.confirmed}</b>
        </span>
        <span className="pool-recycled">
          <RotateCcw size={11} />
          {state.recycled} back again
        </span>
      </div>
    </section>
  );
}
function Events({
  state,
  compact = false,
  all,
}: {
  state: State;
  compact?: boolean;
  all?: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const events = state.events.filter(
    (e) => filter === "all" || e.kind === filter,
  );
  const list = useRef<HTMLDivElement>(null);
  useActivityMotion(list, events.slice(0, compact ? 5 : 100).map((event) => event.id));
  return (
    <section className={`panel w-events ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE PLAY-BY-PLAY</span>
          <h2>
            {compact
              ? "Just happened."
              : "A queue with receipts."}
          </h2>
          <p>{state.mode === "live" ? "Queue updates" : "Practice updates"} · newest first</p>
        </div>
        {compact ? (
          <button
            className="icon-button"
            aria-label="View all activity"
            onClick={all}
          >
            <ArrowUpRight size={17} />
          </button>
        ) : (
          <span className="event-total">{events.length} events</span>
        )}
      </div>
      {!compact && (
        <div
          className="event-filters"
          role="group"
          aria-label="Filter activity"
        >
          {[
            ["all", "All events"],
            ["control", "Changes"],
            ["admit", "Taking turns"],
            ["confirm", "Confirmations"],
            ["recycle", "Back again"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "selected" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div ref={list} className="w-event-list" role="log" aria-label="Queue updates">
        {events.slice(0, compact ? 5 : 100).map((e) => (
          <div className={`w-event ${e.kind}`} key={e.id} data-event-id={e.id}>
            <span className="event-indicator">
              {e.kind === "confirm" ? (
                <Check size={11} />
              ) : e.kind === "recycle" ? (
                <RotateCcw size={11} />
              ) : e.kind === "control" ? (
                <SlidersHorizontal size={11} />
              ) : e.kind === "admit" ? (
                <ArrowRight size={11} />
              ) : (
                <Info size={11} />
              )}
            </span>
            <div>
              <p>{activityCopy(e)}</p>
              <time>
                {time(e.time)}
                <span> / {activityLabels[e.kind]}</span>
              </time>
            </div>
          </div>
        ))}
        {!events.length && (
          <p className="filter-empty">
            Nothing here yet. {state.mode === "live" ? "Join the line or send a test crowd." : "Start a practice run or try a different queue mood."}
          </p>
        )}
      </div>
    </section>
  );
}
function Settings({
  state,
  dispatch,
  close,
}: {
  state: State;
  dispatch: Actions;
  close: () => void;
}) {
  const [demand, setDemand] = useState(state.demand);
  const [maxActive, setMaxActive] = useState(state.maxActive);
  const [holdSeconds, setHoldSeconds] = useState(state.holdSeconds);
  const [adaptive, setAdaptive] = useState(state.adaptive);
  const [admissionRate, setAdmissionRate] = useState(state.configuredRate ?? 4);
  return (
    <Modal title="Set the pace" close={close}>
      <form
        className="policy-form"
        onSubmit={(e) => {
          e.preventDefault();
          dispatch({
            type: "settings",
            demand,
            maxActive,
            holdSeconds,
            adaptive,
            admissionRate,
          });
          close();
        }}
      >
        <p>
          These settings are for this queue. Saved spots keep
          their original timers.
        </p>
        <label>
          {state.mode === "live" ? "Test crowd size" : "Practice crowd size"}
          <select
            value={demand}
            onChange={(e) => setDemand(Number(e.target.value))}
          >
            {[100, 500, 1000].map((n) => (
              <option key={n} value={n} disabled={state.mode !== "live" && n < state.arrivals}>
                {num(n)} test people
              </option>
            ))}
          </select>
        </label>
        <label>
          People let in each second
          <select value={admissionRate} onChange={(event) => setAdmissionRate(Number(event.target.value))}>
            {[...new Set([1, 2, 4, 5, 10, 20, admissionRate])].sort((a, b) => a - b).map((rate) => <option key={rate} value={rate}>{rate} {rate === 1 ? "person" : "people"} per second</option>)}
          </select>
        </label>
        <label>
          People choosing at once
          <select
            value={maxActive}
            onChange={(e) => setMaxActive(Number(e.target.value))}
          >
            {[5, 10, 20].map((n) => (
              <option key={n} value={n} disabled={n < counts(state).held}>
                {n} active at once
              </option>
            ))}
          </select>
        </label>
        <label>
          Time to claim a spot
          <select
            value={holdSeconds}
            onChange={(e) => setHoldSeconds(Number(e.target.value))}
          >
            {[30, 60, 120, 300].map((n) => (
              <option key={n} value={n}>
                {duration(n)} per reservation
              </option>
            ))}
          </select>
        </label>
        <label className="switch-label">
          <span>
            <strong>Auto-adjust entry speed</strong>
            <small>Slow the gate when things get busy. Speed up when they recover.</small>
          </span>
          <input
            type="checkbox"
            checked={adaptive}
            onChange={(e) => setAdaptive(e.target.checked)}
          />
          <i />
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={state.pending || (state.mode === "live" && state.backendStatus !== "online")}>
            Save settings
            <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Participant({ state, dispatch }: { state: State; dispatch: Actions }) {
  const journey = useRef<HTMLDivElement>(null);
  useJourneyMotion(journey, state.phase);
  const [name, setName] = useState(state.participantName);
  const scenario = scenarioDetails(state);
  const c = counts(state);
  const mine = state.resources.find((r) => r.status === "mine");
  const expired = state.phase === "expired";
  const closed = state.queueStatus === "SOLD_OUT" || state.queueStatus === "CLOSED" || (state.resources.length > 0 && c.available === 0 && c.held === 0);
  const seconds = mine
    ? Math.max(0, Math.ceil((mine.expiresAt - state.now) / 1000))
    : 0;
  const step = { ready: 0, queued: 1, admitted: 2, confirmed: 3, expired: 2 }[
    state.phase
  ];
  const qr = useRef<HTMLDivElement>(null);
  const live = state.mode === "live";
  const unavailable = live && (state.backendStatus !== "online" || state.pending);
  function download() {
    const svg = qr.current?.querySelector("svg")?.cloneNode(true) as
      SVGSVGElement | undefined;
    if (!svg) return;
    svg.setAttribute("x", "440");
    svg.setAttribute("y", "110");
    svg.setAttribute("width", "150");
    svg.setAttribute("height", "150");
    const pass = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="350" viewBox="0 0 640 350"><rect width="640" height="350" rx="10" fill="#fffef9"/><path d="M10 0h620q10 0 10 10v62H0V10Q0 0 10 0" fill="#2549e8"/><g font-family="sans-serif"><text x="28" y="46" fill="white" font-size="24" font-weight="bold">QRUSH / YOUR DEMO PASS</text><text x="28" y="125" fill="#181a1c" font-size="26" font-weight="bold">${escapeXml(scenario.name)}</text><text x="28" y="163" fill="#4e5751" font-size="16">Saved for ${escapeXml(state.participantName)}</text><text x="28" y="201" fill="#4e5751" font-size="13">Confirmation</text><text x="28" y="228" fill="#181a1c" font-size="14">${escapeXml(state.receipt)}</text><text x="28" y="318" fill="#4e5751" font-size="13">For this demo only. Not an event ticket or a purchase.</text></g>${new XMLSerializer().serializeToString(svg)}</svg>`;
    downloadFile(`${state.receipt}-${live ? "allocation" : "sample"}.svg`, pass, "image/svg+xml");
  }
  return (
    <div ref={journey} className="participant-layout">
      <section className="participant-context">
        <div className={`participant-poster ${state.scenario}`}>
          <div className="poster-bars" aria-hidden="true">
            {state.resources.slice(0, 24).map((resource) => <i key={resource.id} className={resource.status} style={{ height: `${100 + (resource.id % 5) * 14}px` }} />)}
          </div>
          <span className="eyebrow">{scenario.category.toUpperCase()}</span>
          <h2>
            {state.scenario === "hackathon" ? (
              <>
                BUILD
                <br />
                WHAT’S
                <br />
                <span>NEXT.</span>
              </>
            ) : state.scenario === "product" ? (
              <>
                LESS.
                <br />
                BUT
                <br />
                <span>BETTER.</span>
              </>
            ) : (
              <>
                MAKE
                <br />
                SOME
                <br />
                <span>THING.</span>
              </>
            )}
          </h2>
          <div>
            <span>
              {scenario.capacity} {scenario.resource.toUpperCase()}
              <br />
              ONE FAIR LINE.
            </span>
            <span>
              POWERED BY
              <br />
              QRUSH ↗
            </span>
          </div>
        </div>
        <div className="participant-about">
          <h2>
            {scenario.name}
            <ArrowUpRight size={21} />
          </h2>
          <p>{scenario.description}</p>
          <span>{scenario.detail}</span>
          <div className="participant-stock">
            <span>
              <i className="available" />
              {c.available} available
            </span>
            <span>
              <i className="held" />
              {c.held} saved
            </span>
            <span>
              <i className="confirmed" />
              {c.confirmed} confirmed
            </span>
          </div>
          <div className="availability-track">
            <i
              style={{
                width: `${(c.available / state.resources.length) * 100}%`,
              }}
            />
            <i
              style={{ width: `${(c.held / state.resources.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="participant-promise">
          <ShieldCheck size={20} />
          <div>
            <strong>Refresh away. Your place stays.</strong>
            <p>
              You can refresh this tab and keep your place. If your saved spot’s
              timer runs out, we’ll show you what happened.
            </p>
          </div>
        </div>
      </section>
      <section className="panel participant-journey">
        <p className="visually-hidden" aria-live="polite">{state.phase === "queued" ? `Your place in line: ${state.position || "next"}.` : state.phase === "admitted" ? "It’s your turn. A spot is saved for you." : state.phase === "confirmed" ? "Your spot is confirmed." : ""}</p>
        <div className="journey-steps">
          {["Get ready", "Your queue", "Reserve", "Confirmed"].map(
            (label, i) => (
              <div
                key={label}
                className={`${step === i ? "current" : ""} ${step > i ? "complete" : ""}`}
              >
                <span>{step > i ? <Check size={11} /> : i + 1}</span>
                <small>{label}</small>
              </div>
            ),
          )}
        </div>
        {["ready", "expired"].includes(state.phase) && (
          <>
            <span className="eyebrow">
              {expired ? "TRY AGAIN" : "GET YOUR PLACE"}
            </span>
            <h2>
              {expired
                ? "Time’s up for that spot."
                : closed
                  ? "All spots are taken."
                  : "Ready when you are."}
            </h2>
            <p>
              {expired
                ? "Your spot is available to someone else now. You can join again if there are places left."
                : closed
                  ? "Every spot has been claimed. Pick another queue in Overview."
                  : "Join once. Watch your place. We’ll let you know when you’re up."}
            </p>
            <form
              className="join-form"
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({ type: "join", name });
              }}
            >
              <label htmlFor="participant-name">What should we call you?</label>
              <input
                id="participant-name"
                value={name}
                maxLength={60}
                required
                autoComplete="given-name"
                placeholder="Your name"
                onChange={(e) => setName(e.target.value)}
                disabled={closed || unavailable}
              />
              <button
                className="button primary full"
                disabled={!name.trim() || closed || unavailable}
              >
                {expired
                  ? "Rejoin the waiting room"
                  : closed
                    ? "All spots taken"
                    : "Join the waiting room"}
                <ArrowRight size={16} />
              </button>
            </form>
            <div className="participant-disclosure">
              <Info size={14} />
              <span>
                {live ? "No account needed. Your place is saved in this browser." : "This is a practice run, saved in this tab."}
              </span>
            </div>
          </>
        )}
        {state.phase === "queued" && (
          <>
            <Pill tone={state.fault === "outage" ? "amber" : "green"}>
              {closed
                ? "ALL SPOTS TAKEN"
                : state.fault === "outage"
                  ? "ENTRY IS PAUSED"
                  : "YOU’RE IN LINE"}
            </Pill>
            <h2>
              {closed
                ? "This queue has filled up."
                : state.fault === "outage"
                  ? "Taking a short breather."
                  : live && state.position === 0
                    ? "Finding your spot."
                  : "You’re on the list."}
            </h2>
            <p>
              {closed
                ? "Every spot has been claimed. Leave this line and try another queue."
                : state.fault === "outage"
                  ? "This queue is paused for a test. Your place in line is still saved."
                  : `You’re in line for ${scenario.name}. No refreshing required.`}
            </p>
            <div className="participant-position">
              <span>YOUR PLACE IN LINE</span>
              <strong>{live && state.position === 0 && !closed ? "NEXT" : <>#<AnimatedNumber value={state.position} /></>}</strong>
              <span>
                {closed
                  ? "No spots left to claim"
                  : state.fault === "outage"
                    ? "The time estimate will return when entry starts again"
                    : live
                      ? state.position === 0 ? "It’s your turn · finding an available spot" : state.estimatedWaitSeconds == null ? "Wait estimate currently unavailable" : `Estimated ~${state.estimatedWaitSeconds} seconds · may change`
                      : `Estimated ${Math.max(1, Math.ceil(state.position / Math.max(1, state.rate)))}–${Math.max(3, Math.ceil(state.position / Math.max(1, state.rate)) + 8)} seconds · may change`}
              </span>
            </div>
            <div className="identity-line">
              <span>{live ? "YOUR QUEUE PASS" : "YOUR PRACTICE PASS"}</span>
              <strong>
                {state.participantId}
                <ShieldCheck size={12} />
              </strong>
            </div>
            <div className="soft-note">
              <Info size={15} />
              <span>
                {closed
                  ? "Being in line doesn’t guarantee a spot. All spots are taken or saved for someone right now."
                  : "You can refresh this tab and keep your place. Spots may get taken while you wait."}
              </span>
            </div>
            <button
              className="text-button participant-leave"
              disabled={unavailable}
              onClick={() => dispatch({ type: "leave" })}
            >
              Leave the queue
            </button>
          </>
        )}
        {state.phase === "admitted" && (
          <>
            <Pill>IT’S YOUR TURN</Pill>
            <h2>Make it yours, {state.participantName.split(" ")[0]}.</h2>
            <p>
              One {scenario.singular} is reserved for you. Confirm before the
              clock runs out.
            </p>
            <div
              className={`reservation-clock ${seconds < 30 ? "urgent" : ""}`}
            >
              <Clock3 size={25} />
              <strong>{duration(seconds)}</strong>
              <span>
                LEFT TO
                <br />
                CLAIM YOUR SPOT
              </span>
            </div>
            <div className="reservation-details">
              <span>
                Your spot
                <strong>#{String(mine?.id ?? 0).padStart(3, "0")}</strong>
              </span>
              <span>
                Name<strong>{state.participantName}</strong>
              </span>
              <span>
                {live ? "Queue pass" : "Practice pass"}<strong>{state.participantId}</strong>
              </span>
            </div>
            {state.fault === "outage" && (
              <div className="soft-note">
                <Info size={15} />
                <span>
                  Confirmation is paused for this test. Your
                  timer still runs, so this spot may become available again.
                </span>
              </div>
            )}
            <button
              className="button primary full"
              disabled={
                state.fault === "outage" || !state.connected || seconds === 0 || unavailable
              }
              onClick={() => dispatch({ type: "confirm" })}
            >
              {scenario.action}
              <ArrowRight size={16} />
            </button>
            <span className="participant-demo-caption">
              {live ? "Local demo · no payment or real event booking" : "Practice pass · no real booking"}
            </span>
            <button
              className="text-button participant-leave"
              disabled={unavailable}
              onClick={() => dispatch({ type: "leave" })}
            >
              Release my reservation
            </button>
          </>
        )}
        {state.phase === "confirmed" && (
          <>
            <div className="success-symbol">
              {Array.from({ length: 8 }, (_, index) => <i key={index} className="celebration-bit" aria-hidden="true" />)}
              <CheckCheck size={29} />
            </div>
            <h2 className="centered">You’re in. Nice one!</h2>
            <p className="centered">
              Your {live ? "confirmation" : "practice pass"} is ready.
              <br />
              One person. One spot.
            </p>
            <div className="participant-receipt">
              <strong>{scenario.name}</strong>
              <span>{state.receipt}</span>
              <div ref={qr}>
                <QRCodeSVG
                  value={JSON.stringify({
                    demo: !live,
                    signed: false,
                    flow: state.scenario,
                    receipt: state.receipt,
                    participant: state.participantId,
                  })}
                  size={132}
                  marginSize={3}
                />
              </div>
              <small>{live ? "DEMO PASS · NOT AN ENTRY TICKET" : "PRACTICE PASS · NOT AN ENTRY TICKET"}</small>
            </div>
            <button className="button primary full" onClick={download}>
              <ArrowDownToLine size={15} />
              {live ? "Save my confirmation" : "Save my practice pass"}
            </button>
          </>
        )}
        {!state.connected && (
          <div className="connection-overlay">
            <WifiOff size={27} />
            <h3>You’re temporarily offline.</h3>
            <p>
              {live ? "We’ve lost the connection. Your place stays in line, and your timer keeps running. Reconnect to see the latest update." : "You’re trying a connection break in practice mode. Your place stays saved and your timer keeps running."}
            </p>
            <button
              className="button primary"
              onClick={() => dispatch({ type: "connection" })}
            >
              <Wifi size={15} />
              Reconnect
            </button>
          </div>
        )}
        <div className="participant-connection">
          <span>
            <i className={`status-dot ${state.connected ? "" : "idle"}`} />
            {state.connected
              ? live ? state.participantId === "Not joined" ? "Ready when you are" : state.streamStatus === "open" ? "Your place is updating live" : "Your place is updating · reconnecting live updates" : "Practice mode is ready"
              : live ? "Updates have paused" : "Practice updates have paused"}
          </span>
          {!["ready", "expired", "confirmed"].includes(state.phase) && (
            <button onClick={() => dispatch({ type: "connection" })}>
              <WifiOff size={12} />
              Try a connection break
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Help({ state }: { state: State }) {
  return (
    <div className="w-help">
      <p>
        Lots of people. Limited spots. QRush keeps a clear line between the
        two. Here’s how to try it.
      </p>
      {[
        {
          icon: Users,
          title: "1. Choose what’s opening",
          text: "Pick a hackathon, product release, or workshop in Overview. Different things to join. One fair way in.",
        },
        {
          icon: Gauge,
          title: "2. Try being in line",
          text: "Open Join the queue, enter a name, and watch your place. When it’s your turn, claim your spot before the timer ends.",
        },
        {
          icon: ShieldCheck,
          title: "3. Give it a rush",
          text: "Open Playground and send a test crowd. Try Slow down, then All good. With auto-adjust on, the entry speed drops and gradually recovers.",
        },
      ].map(({ icon: Icon, title, text }) => (
        <div className="how-step" key={title}>
          <span className="how-icon">
            <Icon size={21} />
          </span>
          <div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        </div>
      ))}
      <div className="note">
        <FlaskConical size={19} />
        <p>
          {state.mode === "live" ? "This is a demo: confirming here doesn’t book an event or charge you. Test crowds are pretend people. Your pass is a reference for this demo, not an entry ticket." : "Practice mode runs queues, reservations and charts locally. Its results are illustrative, not authenticated identities, durable orders, or load-test evidence."}
        </p>
      </div>
    </div>
  );
}
export default function Workspace() {
  const { state, dispatch } = useWorkspace();
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(readView);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [reset, setReset] = useState(false);
  const [nextFlow, setNextFlow] = useState<ScenarioId | null>(null);
  const [inspecting, setInspecting] = useState<number | null>(null);
  useSceneMotion(stage, `${view}:${state.scenario}:${state.mode}`);
  useEffect(() => {
    const sync = () => {
      setView(readView());
      setMenu(false);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    const workspace = document.querySelector(".workspace");
    workspace?.toggleAttribute("inert", menu);
    if (!menu) return;
    document
      .querySelector<HTMLButtonElement>(".sidebar nav button.active")
      ?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      workspace?.removeAttribute("inert");
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);
  function navigate(next: View) {
    setView(next);
    location.hash = next;
    setMenu(false);
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function changeFlow(id: ScenarioId) {
    if (id === state.scenario) return;
    if (state.mode === "live") { dispatch({ type: "scenario", scenario: id }); return; }
    if (
      state.arrivals ||
      state.phase !== "ready" ||
      counts(state).confirmed ||
      state.running
    )
      setNextFlow(id);
    else dispatch({ type: "scenario", scenario: id });
  }
  function exportRun() {
    downloadFile(
      `qrush-${state.scenario}-${state.mode === "live" ? "test-results" : "practice-results"}.json`,
      JSON.stringify(
        {
          environment: state.mode === "live" ? "Live queue test" : "Practice run",
          measuredBenchmark: false,
          lastServerSnapshotAt: state.lastUpdatedAt ? new Date(state.lastUpdatedAt).toISOString() : null,
          backendStatus: state.backendStatus,
          exportedAt: new Date().toISOString(),
          scenario: scenarioDetails(state),
          policy: {
            maxActive: state.maxActive,
            holdSeconds: state.holdSeconds,
            adaptive: state.adaptive,
          },
          metrics: {
            ...counts(state),
            arrivals: state.arrivals,
            waiting: state.waiting,
            recycled: state.recycled,
          },
          history: state.history,
          events: state.events.map((event) => ({ ...event, text: activityCopy(event) })),
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  const inspected = state.resources.find((r) => r.id === inspecting);
  return (
    <div ref={stage} className="app-shell qrush-workspace">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "mobile-open" : ""}`}>
        <a href="#overview" className="brand-link" aria-label="QRush home" onClick={(e) => { e.preventDefault(); navigate("overview"); }}>
          <span className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>qrush<span className="brand-period">↗</span></span>
        </a>
        <nav aria-label="Main navigation">
          {([
            { id: "overview", icon: LayoutDashboard, number: "01" },
            { id: "participant", icon: Users, number: "02" },
            { id: "chaos", icon: FlaskConical, number: "03" },
            { id: "activity", icon: Terminal, number: "04" },
          ] as const).map(({ id, icon: Icon, number }) => (
            <button key={id} className={view === id ? "active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}>
              <span className="nav-number" aria-hidden="true">{number}</span><Icon size={18} /><span>{VIEW_NAMES[id]}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-help" onClick={() => { setMenu(false); setHelp(true); }}><CircleHelp size={20} /><span>Show me around</span></button>
        <button className="icon-button close-mobile" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={22} /></button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <a className="breadcrumb-brand" href="#openings">← Openings</a>
            <ChevronRight size={12} />
            <strong>{VIEW_NAMES[view]}</strong>
          </div>
          <div className="topbar-right">
            <label className="data-mode-picker">
              <Radio size={13} />
              <select aria-label="Choose mode" value={state.mode} disabled={state.pending} onChange={(event) => dispatch({ type: "mode", mode: event.target.value as "live" | "simulation" })}>
                <option value="live">Live queue</option>
                <option value="simulation">Practice mode</option>
              </select>
            </label>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Open queue settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
            </button>
            <span className="avatar" aria-label="Guest workspace">
              G
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Heading
            eyebrow={
              view === "overview"
                ? "QRUSH / THE LIVE WAITING ROOM"
                : view === "participant"
                  ? "YOUR PLACE, YOUR PACE"
                  : view === "chaos"
                    ? "CONTROLLED CHAOS. GO ON, PUSH IT."
                    : "NOTHING BEHIND THE CURTAIN"
            }
            title={
              view === "overview" ? (
                <>
                  Who’s <span>next?</span>
                </>
              ) : view === "participant" ? (
                <>
                  Your spot <span>starts here.</span>
                </>
              ) : view === "chaos" ? (
                <>
                  Bring on <span>the crowd.</span>
                </>
              ) : (
                <>
                  Every move. <span>On record.</span>
                </>
              )
            }
            subtitle={
              view === "overview"
                ? "Choose a queue. Join it. Or send a crowd and see what happens."
                : view === "participant"
                  ? "A clear place in line, a real countdown, and no mystery spinner."
                  : view === "chaos"
                    ? "Send test buyers, slow things down, and watch the queue recover."
                    : "The latest queue updates, reservations, and confirmations."
            }
          >
            {view === "overview" ? (
              <>
                <button
                  className="button secondary"
                  onClick={() => navigate("participant")}
                >
                  Try the queue
                  <ArrowUpRight size={14} />
                </button>
                <RunButton state={state} dispatch={dispatch} />
              </>
            ) : view === "participant" ? (
              <button
                className="button secondary"
                onClick={() => navigate("overview")}
              >
                <LayoutDashboard size={14} />
                Back to control
              </button>
            ) : (
              <>
                <button className="button secondary" onClick={exportRun}>
                  <ArrowDownToLine size={14} />
                  Export results
                </button>
                {view === "chaos" && (
                  <RunButton state={state} dispatch={dispatch} />
                )}
              </>
            )}
          </Heading>
          {state.mode === "live" && (
            <div className={`live-status-banner ${state.backendStatus}`} role="status">
              {state.backendStatus === "online" ? <ShieldCheck size={18} /> : <WifiOff size={18} />}
              <div>
                <strong>{state.backendStatus === "online" ? "Live updates are on" : state.backendStatus === "checking" ? "Connecting to QRush…" : "The queue can’t be reached"}</strong>
                <span>{state.error ?? (state.backendStatus === "online" ? `Shared queue. Changes appear across tabs. ${state.fault === "outage" ? "Entry is paused for a test. Your place in line stays saved." : "You’re seeing the latest changes."}` : "Try reconnecting, or choose Practice mode to explore while you wait.")}</span>
                {state.lastUpdatedAt > 0 && state.backendStatus === "offline" && <small>Last update: {time(state.lastUpdatedAt)}</small>}
              </div>
              {state.backendStatus === "offline" && <button className="button secondary" onClick={() => dispatch({ type: "retry" })}>Reconnect</button>}
              {state.pending && <small>Saving…</small>}
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="section-kicker">
                <span>01 / CHOOSE WHAT’S OPENING</span>
                <button onClick={() => setSettings(true)}>
                  <SlidersHorizontal size={12} />
                  Queue settings
                  <ArrowUpRight size={12} />
                </button>
              </div>
              <FlowPicker state={state} change={changeFlow} />
              <Pipeline
                state={state}
                participant={() => navigate("participant")}
              />
              <Metrics state={state} />
              <div className="workspace-grid">
                <ResponseChart state={state} />
                <FaultControls
                  state={state}
                  dispatch={dispatch}
                  settings={() => setSettings(true)}
                />
              </div>
              <div className="workspace-grid lower-grid">
                <ResourcePool
                  state={state}
                  inspect={(r) => setInspecting(r.id)}
                />
                <Events
                  state={state}
                  compact
                  all={() => navigate("activity")}
                />
              </div>
              <div className="workspace-tip">
                <Sparkles size={19} />
                <div>
                  <strong>Curious what happens in a rush?</strong>
                  <p>
                    {state.mode === "live" ? "Send test crowd" : "Start a practice run"}, try Slow down, then Back to normal. Watch
                    the entry speed change and recover.
                  </p>
                </div>
                <button onClick={() => navigate("chaos")}>
                  Try the Playground
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
          {view === "participant" && (
            <Participant state={state} dispatch={dispatch} />
          )}
          {view === "chaos" && (
            <>
              <div className="experiment-intro">
                <span className="experiment-icon">
                  <FlaskConical size={25} />
                </span>
                <div>
                  <span className="eyebrow">YOUR THREE-STEP EXPERIMENT</span>
                  <h2>Crowd. Slowdown. Comeback.</h2>
                  <p>
                    Send a test crowd → slow confirmations →
                    bring things back.
                  </p>
                </div>
                <Pill tone={state.running ? "green" : "neutral"}>
                  {state.running ? state.mode === "live" ? "TEST CROWD ON THE WAY" : "PRACTICE RUNNING" : "READY WHEN YOU ARE"}
                </Pill>
              </div>
              <div className="experiment-toolbar">
                <div>
                  <strong>{scenarioDetails(state).name}</strong>
                  <span>
                    {num(state.demand)} test people · {state.maxActive}{" "}
                    people choosing at once
                  </span>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setSettings(true)}
                >
                  <SlidersHorizontal size={14} />
                  Set up test
                </button>
                <button
                  className="button secondary"
                  onClick={() => dispatch({ type: "recycle" })}
                  disabled={state.pending || (state.mode === "live" && state.backendStatus !== "online")}
                >
                  <RotateCcw size={14} />
                  {state.mode === "live" ? "Check returning spots" : "Bring back unclaimed spots"}
                </button>
                <button
                  className="icon-button"
                  aria-label={state.mode === "live" ? "Clear chart history" : "Reset experiment"}
                  onClick={() => setReset(true)}
                >
                  <RotateCcw size={17} />
                </button>
              </div>
              <Metrics state={state} />
              <div className="workspace-grid">
                <ResponseChart state={state} />
                <FaultControls
                  state={state}
                  dispatch={dispatch}
                  settings={() => setSettings(true)}
                />
              </div>
              <div className="workspace-grid lower-grid">
                <ResourcePool
                  state={state}
                  inspect={(r) => setInspecting(r.id)}
                />
                <section className="panel experiment-checks">
                  <span className="eyebrow">YOUR EXPERIMENT CHECKLIST</span>
                  <h2>Try it. See it. Get it.</h2>
                  {[
                    {
                      done: state.arrivals > 0,
                      label: "Send a test crowd",
                      text: `${num(state.arrivals)} people have arrived.`,
                    },
                    {
                      done: state.events.some((event) => activitySignal(event) === "slow"),
                      label: "Try a slowdown",
                      text: "Watch the entry speed drop with auto-adjust on.",
                    },
                    {
                      done: state.events.some((event) => activitySignal(event) === "restore"),
                      label: "Bring things back to normal",
                      text: "Watch more people get their turn.",
                    },
                    {
                      done: state.recycled > 0,
                      label: "Watch a spot come back",
                      text: `${state.recycled} saved spots became available again.`,
                    },
                  ].map(({ done, label, text }) => (
                    <div className={done ? "done" : ""} key={label}>
                      <span>{done ? <Check size={12} /> : <span />}</span>
                      <div>
                        <strong>{label}</strong>
                        <p>{text}</p>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
              <Events state={state} compact all={() => navigate("activity")} />
              <div className="note">
                <Info size={18} />
                <p>
                  {state.mode === "live" ? "Test crowds are pretend people using this queue. Slow down and Pause entry let you try different situations. A saved spot comes back when its timer runs out." : "This practice run stays in your browser. Its people and bookings are pretend. Reset whenever you want a fresh start."}
                </p>
              </div>
            </>
          )}
          {view === "activity" && (
            <>
              <div className="activity-context">
                <Radio size={16} />
                <span>{scenarioDetails(state).name}</span>
                <Pill tone={state.running ? "green" : "neutral"}>
                  {state.mode === "live" ? state.running ? "TEST CROWD ON THE WAY" : "LIVE QUEUE UPDATES" : state.running ? "PRACTICE RUNNING" : "PRACTICE PAUSED"}
                </Pill>
                <span className="activity-context-count">
                  {state.events.length} most recent events retained
                </span>
              </div>
              <Events state={state} />
            </>
          )}
          <footer className="page-footer">
            <span>
              QRush / Know where you stand.
              <span className="footer-spark">✳</span>
            </span>
            <span>
              <i
                className={`status-dot ${state.backendStatus === "online" || state.mode === "simulation" ? "" : "idle"}`}
              />
              {state.mode === "simulation" ? "Practice mode · stays in this browser" : state.backendStatus === "checking" ? "Connecting to your queue…" : state.backendStatus === "online" ? "Connected · your queue is up to date" : "Connection lost · showing the last update"}
              <button onClick={() => setReset(true)}>{state.mode === "live" ? "Clear chart history" : "Reset workspace"}</button>
            </span>
          </footer>
        </main>
      </div>
      {state.notice && (
        <div className="toast" role="status">
          <Info size={17} />
          <span>{noticeCopy(state.notice)}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => dispatch({ type: "dismiss" })}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal
          title="The 30-second tour"
          close={() => setHelp(false)}
        >
          <Help state={state} />
        </Modal>
      )}
      {settings && (
        <Settings
          state={state}
          dispatch={dispatch}
          close={() => setSettings(false)}
        />
      )}
      {(reset || nextFlow) && (
        <Modal
          title={
            nextFlow
              ? "Try a different queue?"
              : state.mode === "live" ? "Clear chart history?" : "Start this experiment again?"
          }
          close={() => {
            setReset(false);
            setNextFlow(null);
          }}
        >
          <p className="reset-copy muted">
            {nextFlow
              ? `Switching to ${scenarioDetails(state, nextFlow).name} starts a fresh practice run. Your current queue, saved spot, pass, and updates will be cleared.`
              : state.mode === "live" ? "This clears your chart. Everyone’s place, saved spots, and confirmations stay just as they are." : "This clears the practice crowd, line, saved spots, and pass for this queue."}
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setReset(false);
                setNextFlow(null);
              }}
            >
              Keep exploring
            </button>
            <button
              className="button primary"
              onClick={() => {
                dispatch(
                  nextFlow
                    ? { type: "scenario", scenario: nextFlow }
                    : { type: "reset" },
                );
                setReset(false);
                setNextFlow(null);
              }}
            >
              {nextFlow ? "Switch queue" : state.mode === "live" ? "Clear chart history" : "Reset experiment"}
              <RotateCcw size={14} />
            </button>
          </div>
        </Modal>
      )}
      {inspected && (
        <Modal
          title={`Spot #${String(inspected.id).padStart(3, "0")}`}
          close={() => setInspecting(null)}
        >
          <div className="resource-inspector">
            <Pill
              tone={
                inspected.status === "held" || inspected.status === "mine"
                  ? "amber"
                  : "green"
              }
            >
              {{ mine: "SAVED FOR YOU", held: "SOMEONE’S DECIDING", confirmed: "CLAIMED", available: "UP FOR GRABS" }[inspected.status]}
            </Pill>
            <dl>
              <div>
                <dt>Queue</dt>
                <dd>{scenarioDetails(state).name}</dd>
              </div>
              <div>
                <dt>Reserved for</dt>
                <dd>
                  {inspected.status === "available" ? "Nobody yet. This spot is free." : inspected.status === "mine" ? state.participantName || "You" : inspected.status === "held" ? "Someone who’s choosing right now" : "Someone who already confirmed"}
                </dd>
              </div>
              {["held", "mine"].includes(inspected.status) && (
                <div>
                  <dt>Time left</dt>
                  <dd>
                    {state.mode === "live" && inspected.expiresAt === 0 ? "Checking this spot…" : duration(
                      Math.max(
                        0,
                        Math.ceil((inspected.expiresAt - state.now) / 1000),
                      ),
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <div className="note">
              <ShieldCheck size={17} />
              <p>
                {inspected.status === "confirmed" ? "This one’s taken. There may still be other spots to claim." : inspected.status === "mine" ? "This one’s saved for you. Confirm before your timer runs out." : inspected.status === "held" ? "Someone is deciding. If their timer runs out, this spot becomes available again." : "This spot is free. When someone gets their turn, it can be saved for them."}
              </p>
            </div>
            {inspected.status !== "confirmed" && <button className="button primary full spot-next" onClick={() => { setInspecting(null); navigate("participant"); }}>{state.phase === "ready" || state.phase === "expired" ? "Join this queue" : "See my place"}<ArrowRight size={16} /></button>}
          </div>
        </Modal>
      )}
    </div>
  );
}
