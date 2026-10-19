import type { Event } from "./workspaceEngine";

const spot = (value: string) => `#${value.match(/(\d+)$/)?.[1].padStart(3, "0") ?? "—"}`;
const time = (seconds: number) => seconds >= 60 && seconds % 60 === 0
  ? `${seconds / 60} minute${seconds === 60 ? "" : "s"}`
  : `${seconds} seconds`;

/** Public activity is deliberately described here, never printed from internal logs. */
export function activityCopy(event: Pick<Event, "kind" | "text">) {
  const text = event.text;
  let match: RegExpMatchArray | null;
  if ((match = text.match(/(?:Confirmed|confirmed)\s+([\w-]+)\s+(?:in PostgreSQL|in the database)/))) return `Spot ${spot(match[1])} is confirmed. Someone’s in!`;
  if ((match = text.match(/Reserved\s+([\w-]+)\s+for\s+(\d+)\s+seconds/))) return `Spot ${spot(match[1])} is saved for ${time(Number(match[2]))}.`;
  if ((match = text.match(/^(\d+)\s+participants? admitted/))) return `${match[1]} ${match[1] === "1" ? "person can" : "people can"} now choose a spot.`;
  if ((match = text.match(/(?:Expired reservation|Released)\s+([\w-]+)/))) return `Spot ${spot(match[1])} is back up for grabs.`;
  if (/joined the waiting room|joined the queue|joined the line/i.test(text)) return "Someone joined the line. Welcome aboard.";
  if (/participant left|left the waiting room|left the queue/i.test(text)) return "Someone left the line.";
  if ((match = text.match(/Started\s+(\d+)\s+virtual participants/i))) return `Sending a test crowd of ${match[1]} into the line.`;
  if (/Stopping .*virtual participants|Traffic paused|Simulation paused/i.test(text)) return "The test crowd is stopping. Your place stays saved.";
  if (/OUTAGE|backend outage|New admissions and confirmations are paused/i.test(text)) return "The line is paused for a test. Saved spots still have a timer.";
  if (/SLOW|slowdown/i.test(text)) return "Things are moving more slowly. The queue is adjusting.";
  if (/NORMAL|Backend restored|capacity recovered/i.test(text)) return "Back to normal. Let’s get the line moving again.";
  if (/Policy updated|policy saved/i.test(text)) return "Queue settings saved. Existing timers stay the same.";
  if (/interrupted confirmation|recovery/i.test(text)) return "An interrupted booking was cleared. Its spot is available again.";
  if ((match = text.match(/^(\d+)\s+(?:expired reservation|simulated abandoned hold|simulated hold)/i))) return `${match[1]} saved ${match[1] === "1" ? "spot is" : "spots are"} available again.`;
  if (/Admission adjusted/i.test(text)) return "The entry speed changed to keep the line moving comfortably.";
  if (/Your reservation|reserved for you|your spot/i.test(text) && event.kind === "admit") return "It’s your turn! A spot is saved for you.";
  if (/confirm/i.test(text) && event.kind === "confirm") return "A spot was confirmed. Nice one!";
  if (/join/i.test(text) && event.kind === "info") return "Someone joined the line.";
  // New/unrecognized diagnostic messages never become accidental product copy.
  return {
    confirm: "A spot was confirmed.",
    admit: "More people can now choose a spot.",
    recycle: "A saved spot is available again.",
    control: "The queue settings changed.",
    info: "There’s a new update from the queue.",
  }[event.kind];
}

export const activityLabels: Record<Event["kind"], string> = {
  info: "Update", admit: "Taking turns", confirm: "Confirmed", recycle: "Back again", control: "Changes",
};

export function activitySignal(event: Pick<Event, "text">) {
  if (/SLOW|slowdown/i.test(event.text)) return "slow";
  if (/NORMAL|Backend restored|capacity recovered/i.test(event.text)) return "restore";
  if (/OUTAGE|outage/i.test(event.text)) return "pause";
  return undefined;
}

export function friendlyProblem(error: unknown, action?: string) {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "Your queue pass has expired. Join again to get a fresh one.";
  if (status === 403) return "This action isn’t available here. You can still check your place in line.";
  if (status === 409 && action === "start") return "A test crowd is already running. Stop it before sending another.";
  if (status === 409) return "That spot is no longer saved for you. Check your place and try again.";
  if (status === 503 && action === "confirm") return "We couldn’t check your confirmation just now. Try again; we’ll keep the same booking if it already went through.";
  if (status === 400) return "That didn’t work. Check your choices and try again.";
  if (status >= 500) return "The queue is taking a breather. Please try again in a moment.";
  return "We couldn’t reach the queue. Check your connection and try again.";
}

export function noticeCopy(message: string) {
  if (!/postgres|redis|backend|server|lease|reconcil|allocat|concurr|admission|token|session|policy|pool|worker|\bSSE\b|\bSQL\b|\bk6\b|snapshot/i.test(message)) return message;
  if (/expir|no longer valid/i.test(message)) return "Your saved place has expired. Join again if spots are still available.";
  if (/policy|settings/i.test(message)) return "Queue settings saved. Existing spot timers stay the same.";
  if (/stop|paus/i.test(message)) return "The test crowd is stopping. Your own place stays saved.";
  if (/start|load|buyers/i.test(message)) return "Here comes the test crowd. Watch the line move!";
  if (/recycl|reconcil/i.test(message)) return "Spots come back when their timers end. Everyone else keeps their saved place.";
  if (/connect|interrupt/i.test(message)) return "Your updates have paused. Reconnect to see your place.";
  return "Check your queue for the latest update.";
}
