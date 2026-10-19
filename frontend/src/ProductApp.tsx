import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, Clock3, Copy, Plus, ShieldCheck, Ticket, Users } from "lucide-react";
import { Modal } from "./Modal";
import { api, credentials, dateTime, getSession, lookupRegistrations, problem, registrationUrl, savedSessions, type Booking, type Opening, type Registration } from "./productApi";
import { useRegistration } from "./useRegistration";
import { useSceneMotion } from "./motion";
import "./product.css";

const Workspace = lazy(() => import("./Workspace"));
const route = () => location.hash.slice(1) || "openings";
const legacy = new Set(["overview", "participant", "chaos", "activity", "main-content"]);
const clock = (seconds: number) => {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
};
function Brand() {
  return <a href="#openings" className="brand" aria-label="QRush home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>qrush<span className="brand-period">↗</span></a>;
}
function Banner({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div className="p-banner" role="alert"><span>{children}</span>{retry && <button className="p-text-button" onClick={retry}>Try again <ArrowRight size={16} /></button>}</div>;
}
function Status({ children, tone = "blue" }: { children: ReactNode; tone?: string }) {
  return <span className={`p-status ${tone}`}><i />{children}</span>;
}
function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="p-empty"><span className="p-empty-symbol" aria-hidden="true">↗</span><h2>{title}</h2><p>{children}</p>{action}</section>;
}
function ShareLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(registrationUrl(id));
      setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2500);
    } catch { input.current?.select(); input.current?.focus(); }
  }
  return <div className="p-share"><label htmlFor={`share-${id}`}>Your public registration link</label><div><input ref={input} id={`share-${id}`} readOnly value={registrationUrl(id)} onFocus={(e) => e.target.select()} /><button className="button primary" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Link copied" : "Copy link"}</button></div><span role="status">{copied ? "Ready to paste into your group chat." : "Anyone with this link can view the opening and join."}</span></div>;
}
function OpeningCard({ opening, index }: { opening: Opening; index: number }) {
  const scheduled = opening.status === "SCHEDULED";
  const full = opening.confirmed >= opening.capacity;
  return <a className="p-opening-card" href={`#r/${opening.id}`} aria-label={`View ${opening.name}`}>
    <div className={`p-card-art tone-${index % 3}`} aria-hidden="true"><span>{opening.name.slice(0, 1).toUpperCase()}</span><div className="p-art-bars">{[1,2,3,4,5,6,7].map((n) => <i key={n} />)}</div><ArrowUpRight size={30} /></div>
    <div className="p-card-body"><Status tone={scheduled ? "neutral" : full ? "neutral" : "green"}>{scheduled ? "Opens soon" : full ? "All spots taken" : "Open for registration"}</Status><h2>{opening.name}</h2><p>{opening.description}</p><div className="p-card-meta"><span><Users size={17} />{opening.capacity} spots</span><span><CalendarDays size={17} />{scheduled ? dateTime(opening.opensAt) : `${opening.available} available now`}</span></div><span className="p-card-cta">Take a look <ArrowRight size={20} /></span></div>
  </a>;
}
function Openings() {
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const mounted = useRef(true);
  async function refresh() {
    try { const result = await api<Opening[]>("/api/openings"); if (mounted.current) { setOpenings(result); setError(""); } }
    catch (e) { if (mounted.current) setError(problem(e)); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    return () => { mounted.current = false; clearInterval(poll); };
  }, []);
  const visible = openings.filter((o) => filter === "all" || (filter === "soon" ? o.status === "SCHEDULED" : o.status === "OPEN" && o.confirmed < o.capacity));
  return <>
    <section className="p-hero page-heading"><div><span className="eyebrow">BIG INTEREST. A FAIR CHANCE.</span><h1>Good things.<br /><span>Limited spots.</span></h1><p>Find something you’re into. See what’s available, take your turn, and make it yours.</p><a className="p-jump" href="#opening-list" onClick={(e) => { e.preventDefault(); document.getElementById("opening-list")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }}>Find your next thing <ArrowDown size={18} /></a></div><div className="p-hero-note"><span className="p-note-number">01 → YOU</span><h2>A little less<br />“did I get in?”</h2><p>Your place in line. Your time to decide. A clear yes when it’s yours.</p><span className="p-note-stamp"><ShieldCheck size={18} />One spot per registration</span></div></section>
    <section className="p-list-section" id="opening-list"><div className="p-section-heading"><div><span className="eyebrow">THE NOTICEBOARD</span><h2>What’s opening?</h2></div><div className="p-tabs" role="group" aria-label="Filter openings">{[["all", "All openings"], ["now", "Open now"], ["soon", "Coming up"]].map(([key,label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
      {error && <Banner retry={refresh}>{error}</Banner>}
      {loading ? <p className="p-loading" role="status">Checking the noticeboard…</p> : !error && !visible.length ? <Empty title={openings.length ? "Nothing in this view just yet." : "Be the first to open something."} action={<a className="button primary" href="#create">Create an opening <Plus size={18} /></a>}>{openings.length ? "Try another filter to see the other openings." : "Running a workshop, a launch, or a club event? Set up your spots and share one simple link."}</Empty> : <div className="p-opening-grid">{visible.map((opening, index) => <OpeningCard key={opening.id} opening={opening} index={index} />)}</div>}
    </section>
    <section className="p-host-strip"><span className="p-strip-mark" aria-hidden="true">↗</span><div><h2>Your idea. Your crowd.</h2><p>Give them a place to sign up.</p></div><a className="button primary" href="#create">Create an opening <ArrowRight size={18} /></a></section>
  </>;
}
function CreateOpening() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("50");
  const [scheduled, setScheduled] = useState(false);
  const [opensAt, setOpensAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Opening | null>(null);
  const submitting = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  async function submit(e: FormEvent) {
    e.preventDefault(); if (submitting.current) return;
    const time = scheduled ? new Date(opensAt).getTime() : Date.now();
    if (!Number.isFinite(time) || (scheduled && time <= Date.now())) { setError("Pick an opening time in the future."); return; }
    submitting.current = true; setPending(true); setError("");
    try { setCreated(await api<Opening>("/api/openings", "POST", { name: name.trim(), description: description.trim(), capacity: Number(capacity), opensAt: new Date(time).toISOString(), requestId: requestId.current })); }
    catch (e) { setError(problem(e)); }
    finally { submitting.current = false; setPending(false); }
  }
  if (created) return <section className="p-created"><span className="p-success-mark"><CheckCheck size={42} /></span><span className="eyebrow">ONE LINK. LET’S GO.</span><h1>Your opening<br />is <span>ready.</span></h1><p><strong>{created.name}</strong> has {created.capacity} spots. {created.status === "SCHEDULED" ? `Registration opens ${dateTime(created.opensAt)}.` : "Registration is open now."}</p><ShareLink id={created.id} /><div className="p-created-actions"><a className="button primary" href={`#r/${created.id}`}>View registration page <ArrowUpRight size={19} /></a><a className="button secondary" href="#openings">Back to openings</a></div></section>;
  return <>
    <header className="page-heading"><div><span className="eyebrow">MAKE ROOM FOR SOMETHING GOOD</span><h1>Open it <span>up.</span></h1><p>A few details, a set number of spots, and a link to bring everyone together.</p></div></header>
    <div className="p-create-layout"><form className="p-form" onSubmit={submit}><fieldset disabled={pending}><legend className="visually-hidden">Opening details</legend><div className="p-form-section"><span className="p-step-number">01</span><h2>What are you opening?</h2><label htmlFor="opening-name">Give it a name</label><input id="opening-name" required minLength={3} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saturday Design Jam" autoComplete="off" /><label htmlFor="opening-description">What should people know?</label><textarea id="opening-description" required minLength={10} maxLength={2000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who’s it for? What can they expect? Add the location or event date here, too." /><span className="p-field-note">Keep it helpful. People will see this on your public page.</span></div>
      <div className="p-form-section"><span className="p-step-number">02</span><h2>Make some room.</h2><label htmlFor="opening-capacity">How many spots?</label><input className="p-capacity-input" id="opening-capacity" type="number" inputMode="numeric" required min={1} max={1000} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /><span className="p-field-note">Between 1 and 1,000. Each registration can confirm one spot.</span></div>
      <div className="p-form-section"><span className="p-step-number">03</span><h2>When can people join?</h2><div className="p-time-options"><label><input type="radio" name="opening-time" checked={!scheduled} onChange={() => setScheduled(false)} /><span><strong>Right away</strong><small>Open when you publish.</small></span></label><label><input type="radio" name="opening-time" checked={scheduled} onChange={() => setScheduled(true)} /><span><strong>Pick a time</strong><small>Give everyone a countdown.</small></span></label></div>{scheduled && <div className="p-schedule-field"><label htmlFor="opens-at">Registration opens</label><input id="opens-at" type="datetime-local" required value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /><span className="p-field-note">Your time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Everyone sees the same opening moment.</span></div>}</div></fieldset>
      {error && <Banner>{error}</Banner>}<div className="p-publish"><p>You’ll get a public link to share. This local workspace doesn’t charge for spots.</p><button type="submit" className="button primary" disabled={pending}>{pending ? "Creating your opening…" : "Create & get my link"}<ArrowRight size={19} /></button></div></form>
      <aside className="p-preview"><span className="eyebrow">A LITTLE PREVIEW</span><div className="p-preview-paper"><div className="p-preview-top"><span>YOU’RE INVITED</span><ArrowUpRight size={30} /></div><h2>{name.trim() || "Something good is coming."}</h2><p>{description.trim() || "Your description goes here. Tell people why they should be there."}</p><div><span><Users size={18} />{capacity || "—"} spots</span><span><Clock3 size={18} />{scheduled ? (opensAt ? dateTime(new Date(opensAt).toISOString()) : "Opening time to come") : "Open right away"}</span></div><span className="p-preview-footer">A FAIR TURN, POWERED BY QRUSH ↗</span></div><p className="p-preview-hint">People get the details first, then a clear path to their spot.</p></aside></div>
  </>;
}
function Countdown({ end, now }: { end: number; now: number }) {
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
  return <div className="p-countdown" role="timer" aria-label={`Opens in ${days} days, ${hours} hours, ${minutes} minutes and ${seconds % 60} seconds`}>{[[days,"days"],[hours,"hours"],[minutes,"min"],[seconds % 60,"sec"]].map(([value,label]) => <span key={label}><strong>{String(value).padStart(2,"0")}</strong><small>{label}</small></span>)}</div>;
}
function PublicRegistration({ id }: { id: string }) {
  const journey = useRegistration(id);
  const { opening, queue, booking, identity, pending, online, now, localNow } = journey;
  const [name, setName] = useState(identity?.name ?? "");
  const [cancelling, setCancelling] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const confirmed = booking?.status === "CONFIRMED";
  const scheduled = !!opening && (Date.parse(opening.opensAt) > now || opening.status === "SCHEDULED");
  const held = !!queue?.heldUnitId && journey.deadline > localNow && !confirmed;
  const queued = queue?.status === "WAITING" || queue?.status === "ADMITTED" || (queue?.status === "SOLD_OUT" && queue.position > 0);
  const full = !!opening && opening.confirmed >= opening.capacity;
  const state = confirmed ? "confirmed" : held ? "held" : queued ? "queued" : scheduled ? "scheduled" : "ready";
  useSceneMotion(root, state);
  useEffect(() => { if (opening) document.title = `${opening.name} — QRush`; }, [opening?.name]);
  if (journey.loading) return <p className="p-loading" role="status">Getting your opening ready…</p>;
  if (!opening) return <Empty title={journey.missing ? "This link missed its landing." : "We’re having trouble connecting."} action={<a className="button primary" href="#openings">Browse openings <ArrowRight size={18} /></a>}>{journey.error || "Check the link and try again."}</Empty>;
  return <div ref={root}>
    <a href="#openings" className="p-back"><ArrowLeft size={17} />All openings</a>
    <div className="p-registration-layout"><header className="p-opening-title"><div className="p-opening-kicker"><span className="eyebrow">SOMETHING TO LOOK FORWARD TO</span><span className="p-opening-symbol" aria-hidden="true">↗</span></div><h1>{opening.name}</h1></header><article className="p-opening-story"><p className="p-opening-description">{opening.description}</p><div className="p-opening-facts"><span><Users size={22} /><strong>{opening.capacity} spots</strong><small>One per registration</small></span><span><CalendarDays size={22} /><strong>{scheduled ? "Registration opens" : "Registration opened"}</strong><small>{dateTime(opening.opensAt)}</small></span></div><section className="p-availability" aria-label="Live availability"><div><h2>Here’s where things stand.</h2><Status tone={online ? "green" : "neutral"}>{online ? "Live updates" : "Last known update"}</Status></div><div className="p-stock-track"><i style={{ width: `${opening.available / opening.capacity * 100}%` }} /><i style={{ width: `${opening.reserved / opening.capacity * 100}%` }} /></div><div className="p-stock-labels"><span><i />{opening.available} available</span><span><i />{opening.reserved} being claimed</span><span><i />{opening.confirmed} confirmed</span></div></section><div className="p-how-it-works"><span className="eyebrow">YOUR SPOT, IN THREE STEPS</span><ol><li><b>1</b><span>Join when registration opens.</span></li><li><b>2</b><span>If it’s busy, see your place in line.</span></li><li><b>3</b><span>When it’s your turn, confirm within five minutes.</span></li></ol></div></article>
    <section className={`p-join-panel ${confirmed ? "is-confirmed" : ""}`} aria-label="Your registration"><div className="p-panel-top"><span className="eyebrow">{confirmed ? "ALL SET" : "YOUR NEXT MOVE"}</span><Ticket size={25} /></div>
      {journey.error && <Banner retry={journey.retry}>{journey.error}</Banner>}{journey.notice && <p className="p-notice" role="status">{journey.notice}</p>}
      {confirmed ? <><span className="p-success-mark"><CheckCheck size={34} /></span><h2>You’re in, {identity?.name || "friend"}.</h2><p>Your spot is confirmed. Find it again any time in My registrations.</p><div className="p-booking-details"><span>YOUR SPOT<strong>#{booking.unitId.match(/\d+$/)?.[0] ?? booking.unitId}</strong></span><span>CONFIRMATION<strong>{booking.allocationId}</strong></span></div><a className="button primary p-full" href="#registrations">My registrations <ArrowRight size={18} /></a><button className="p-text-button" onClick={() => setCancelling(true)} disabled={pending}>Cancel my registration</button></> : scheduled ? <><Status tone="neutral">Not open just yet</Status><h2>Meet you at<br />the starting line.</h2><p>Registration opens {dateTime(opening.opensAt)}. This page will be ready when the countdown ends.</p><Countdown end={Date.parse(opening.opensAt)} now={now} /><button className="button primary p-full" disabled>Registration opens soon <Clock3 size={18} /></button><span className="p-panel-note">Viewing this page doesn’t reserve a place.</span></> : held ? <><Status tone="green">It’s your turn!</Status><h2>A spot has<br />your name on it.</h2><p>Make it official before the timer ends.</p><div className={`p-hold-clock ${journey.deadline - localNow < 60000 ? "urgent" : ""}`} role="timer" aria-label="Time to confirm">{clock((journey.deadline - localNow) / 1000)}<small>left to confirm</small></div><button className="button primary p-full" disabled={pending || !online} onClick={() => void journey.confirm()}>{pending ? "Checking your spot…" : "Confirm my spot"}<Check size={18} /></button><button className="p-text-button" onClick={() => setLeaving(true)} disabled={pending}>Let someone else have it</button></> : queued && !full ? <><Status>You’re in line</Status><h2>A fair turn.<br />Yours is coming.</h2><div className="p-queue-number"><strong>{queue.position > 0 ? `#${queue.position}` : "You’re next"}</strong><span>{queue.position > 0 ? "your place in line" : "Saving an available spot for you…"}</span></div><p>{queue.estimatedWaitSeconds != null && queue.estimatedWaitSeconds > 0 ? `Roughly ${queue.estimatedWaitSeconds < 60 ? `${queue.estimatedWaitSeconds} seconds` : `${Math.ceil(queue.estimatedWaitSeconds / 60)} minutes`} to your turn. This can change as people finish.` : "Your place updates as people finish. Keep this page open so you can claim your spot."}</p><div className="p-waiting-dots" aria-hidden="true"><i /><i /><i /><ArrowRight size={20} /></div><button className="p-text-button" onClick={() => setLeaving(true)} disabled={pending}>Leave the line</button></> : full ? <><Status tone="neutral">All spots taken</Status><h2>This one<br />filled up.</h2><p>If someone cancels, availability will update here. You haven’t been given a spot.</p><a className="button secondary p-full" href="#openings">Find another opening <ArrowRight size={18} /></a>{queued && <button className="p-text-button" onClick={() => setLeaving(true)}>Leave the line</button>}</> : <><Status tone="green">Registration is open</Status><h2>{booking?.status === "CANCELLED" ? "Another go?" : "Your next good thing starts here."}</h2><p>{opening.available > 0 ? "Join the line. When it’s your turn, we’ll save a spot while you confirm." : "All remaining spots are being claimed. Join the line to wait for one to become available."}</p><form onSubmit={(e) => { e.preventDefault(); void journey.join(name); }}><label htmlFor="participant-name">What should we call you?</label><input id="participant-name" autoComplete="given-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /><button className="button primary p-full" disabled={pending || !online}>{pending ? "Finding your place…" : "Join this opening"}<ArrowRight size={19} /></button></form><span className="p-panel-note">No payment. One confirmed spot per browser pass.</span></>}
      <div className="p-saved-note"><ShieldCheck size={17} /><span>Your progress is saved in this browser. Refreshing won’t create a new registration.</span></div>
    </section></div>
    <div className="p-public-bottom"><span>Something come up? You can cancel a confirmed place in My registrations.</span><a href="#registrations">Find my registrations <ArrowRight size={17} /></a></div>
    {cancelling && <Modal title="Give your spot back?" close={() => setCancelling(false)}><p>You’ll cancel your registration for <strong>{opening.name}</strong>. Your spot can then be claimed by someone else.</p><div className="modal-actions"><button className="button secondary" onClick={() => setCancelling(false)}>Keep my spot</button><button className="button primary" disabled={pending} onClick={() => { setCancelling(false); void journey.cancel(); }}>Yes, cancel registration</button></div></Modal>}
    {leaving && <Modal title="Leave this line?" close={() => setLeaving(false)}><p>You’ll give up your current place and any spot saved for you. You can join again at the back of the line.</p><div className="modal-actions"><button className="button secondary" onClick={() => setLeaving(false)}>Stay in line</button><button className="button primary" onClick={() => { setLeaving(false); void journey.leave(); }}>Leave the line</button></div></Modal>}
  </div>;
}
function MyRegistrations() {
  const [items, setItems] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [cancelTarget, setCancelTarget] = useState<{ registration: Registration; booking: Booking } | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const polling = useRef(false);
  async function refresh() {
    if (polling.current) return;
    polling.current = true;
    try { const result = savedSessions().length ? await lookupRegistrations() : []; if (mounted.current) { setItems(result); setError(""); } }
    catch (e) { if (mounted.current) setError(problem(e)); }
    finally { polling.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    window.addEventListener("focus", refresh); window.addEventListener("storage", refresh); window.addEventListener("qrush-registrations-changed", refresh);
    return () => { mounted.current = false; clearInterval(poll); window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); window.removeEventListener("qrush-registrations-changed", refresh); };
  }, []);
  async function cancel() {
    const target = cancelTarget; if (!target || pending) return;
    const session = getSession(target.registration.flowId); if (!session) return;
    setPending(true); setError("");
    try {
      await api(`/api/pools/${target.registration.flowId}/cancel?${credentials(session)}`, "POST", { claimantId: session.claimantId, allocationId: target.booking.allocationId });
      setCancelTarget(null); setNotice("Registration cancelled. Someone else can have a turn."); await refresh();
    } catch (e) { setCancelTarget(null); setError(problem(e, "cancel")); }
    finally { setPending(false); }
  }
  const rows = items.flatMap((registration) => {
    const history = registration.history ?? [];
    const active = history.find((b) => b.status === "CONFIRMED");
    const q = registration.queue;
    const inProgress = !active && q && (q.status === "WAITING" || q.status === "ADMITTED" || (q.status === "SOLD_OUT" && q.position > 0));
    const result: { registration: Registration; booking?: Booking; kind: string; key: string }[] = [];
    if (active) result.push({ registration, booking: active, kind: "confirmed", key: active.allocationId });
    if (inProgress) result.push({ registration, kind: "progress", key: registration.flowId + "-progress" });
    for (const booking of history.filter((b) => b.status === "CANCELLED")) result.push({ registration, booking, kind: "cancelled", key: booking.allocationId });
    if (!result.length) result.push({ registration, kind: registration.status === "OK" ? "unfinished" : "unavailable", key: registration.flowId });
    return result;
  });
  const visible = rows.filter((row) => filter === "all" || (filter === "progress" ? row.kind === "progress" || row.kind === "unfinished" : row.kind === filter));
  return <>
    <header className="page-heading"><div><span className="eyebrow">YOUR PLANS, IN ONE PLACE</span><h1>Saved you<br />a <span>spot.</span></h1><p>Pick up where you left off, find a confirmation, or give a place back.</p></div><a className="button secondary" href="#openings">Find an opening <ArrowUpRight size={18} /></a></header>
    <p className="p-device-note"><ShieldCheck size={20} />Registrations are saved in this browser. Use the same browser to return; there’s no account or cross-device sign-in yet.</p>
    {error && <Banner retry={refresh}>{error}</Banner>}{notice && <p className="p-notice" role="status">{notice}</p>}
    <div className="p-section-heading"><h2>My registrations <span className="p-count">{rows.length}</span></h2><div className="p-tabs" role="group" aria-label="Filter registrations">{[["all","All"],["progress","In progress"],["confirmed","Confirmed"],["cancelled","Cancelled"]].map(([key,label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
    {loading ? <p className="p-loading" role="status">Finding your saved places…</p> : !visible.length && !error ? <Empty title={rows.length ? "Nothing here right now." : "Your next plan belongs here."} action={<a className="button primary" href="#openings">Browse openings <ArrowRight size={18} /></a>}>{rows.length ? "Try another filter to see your saved registrations." : "Join an opening and your progress will appear here automatically."}</Empty> : <div className="p-registration-list">{visible.map(({ registration, booking, kind, key }) => {
      const q = registration.queue;
      const title = registration.name || getSession(registration.flowId)?.openingName || "Saved registration";
      const href = registration.published === false ? "#participant" : `#r/${registration.flowId}`;
      return <article className={`p-registration-card ${kind}`} key={key}><div className="p-registration-icon"><Ticket size={26} /></div><div className="p-registration-main"><Status tone={kind === "confirmed" ? "green" : kind === "cancelled" || kind === "unavailable" ? "neutral" : "blue"}>{kind === "confirmed" ? "Confirmed" : kind === "cancelled" ? "Cancelled" : kind === "unavailable" ? "Browser pass unavailable" : q?.heldUnitId ? "A spot is waiting for you" : kind === "progress" ? "In the queue" : "Ready to resume"}</Status><h2>{title}</h2><p>{booking ? (kind === "cancelled" ? `Cancelled ${dateTime(booking.cancelledAt!)}` : `Confirmed ${dateTime(booking.confirmedAt)}`) : kind === "unavailable" ? "We can’t unlock this saved place. Clearing browser data or an expired pass can prevent access." : q?.heldUnitId ? "Your timer is running. Open your registration to confirm before it ends." : q?.status === "WAITING" ? `You’re #${q.position} in line. Your place stays saved while you’re away.` : "Open your registration to check availability and continue."}</p>{booking && <span className="p-booking-reference">Reference: {booking.allocationId}</span>}</div><div className="p-registration-actions">{kind === "confirmed" ? <><a className="button secondary" href={href}>View registration <ArrowUpRight size={17} /></a><button className="p-text-button" disabled={pending} onClick={() => setCancelTarget({ registration, booking: booking! })}>Cancel registration</button></> : kind === "cancelled" ? <a className="p-text-button" href={href}>View opening <ArrowUpRight size={17} /></a> : kind !== "unavailable" ? <a className="button primary" href={href}>Resume registration <ArrowRight size={18} /></a> : null}</div></article>;
    })}</div>}
    {cancelTarget && <Modal title="Cancel this registration?" close={() => { if (!pending) setCancelTarget(null); }}><p>Your confirmed place for <strong>{cancelTarget.registration.name}</strong> will become available for someone else. You’ll keep a cancellation record here.</p><div className="modal-actions"><button className="button secondary" disabled={pending} onClick={() => setCancelTarget(null)}>Keep my spot</button><button className="button primary" disabled={pending} onClick={() => void cancel()}>{pending ? "Cancelling…" : "Yes, cancel registration"}</button></div></Modal>}
  </>;
}

export default function ProductApp() {
  const [view, setView] = useState(route);
  const root = useRef<HTMLDivElement>(null);
  useSceneMotion(root, view);
  useEffect(() => {
    const sync = () => { setView(route()); window.scrollTo({ top: 0, behavior: "instant" }); };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => { if (!view.startsWith("r/")) document.title = "QRush — Good things. Limited spots."; }, [view]);
  if (legacy.has(view)) return <Suspense fallback={<p className="p-loading">Opening the playground…</p>}><Workspace /></Suspense>;
  const publicId = view.startsWith("r/") ? view.slice(2) : null;
  const validId = publicId && /^[A-Za-z0-9_-]{1,80}$/.test(publicId);
  return <div ref={root} className="p-app"><a href="#product-content" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById("product-content")?.focus(); }}>Skip to content</a><header className="p-header"><Brand /><nav aria-label="Main navigation"><a href="#openings" aria-current={view === "openings" ? "page" : undefined}>Openings</a><a href="#registrations" aria-current={view === "registrations" ? "page" : undefined}>My registrations</a></nav><a href="#create" className="button primary p-create-link" aria-label="Create an opening" aria-current={view === "create" ? "page" : undefined}><Plus size={18} /><span>Create an opening</span></a></header><main id="product-content" tabIndex={-1}>
    {view === "openings" ? <Openings /> : view === "create" ? <CreateOpening /> : view === "registrations" ? <MyRegistrations /> : validId ? <PublicRegistration key={publicId} id={publicId} /> : <Empty title="A little lost?" action={<a className="button primary" href="#openings">Back to openings <ArrowRight size={18} /></a>}>That page doesn’t exist. Let’s get you back to the noticeboard.</Empty>}
  </main><footer className="p-footer"><Brand /><p>Big interest. A fair chance.</p><a href="#overview">Try the queue playground <ArrowUpRight size={16} /></a><span>Built for this local workspace.</span></footer></div>;
}
