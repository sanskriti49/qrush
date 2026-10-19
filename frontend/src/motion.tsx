import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { gsap } from "gsap";
import type { Resource } from "./workspaceEngine";

const preference = () => window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify: () => void) => {
  const media = preference();
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => preference().matches, () => true);

export function AnimatedNumber({ value }: { value: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const current = useRef({ value });
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const show = () => { if (element.current) element.current.textContent = Math.round(current.current.value).toLocaleString("en-IN"); };
    if (reduced) { current.current.value = value; show(); return; }
    const tween = gsap.to(current.current, { value, duration: .45, ease: "power2.out", onUpdate: show });
    return () => { tween.kill(); };
  }, [value, reduced]);
  return <span aria-label={value.toLocaleString("en-IN")}><span ref={element} aria-hidden="true">{value.toLocaleString("en-IN")}</span></span>;
}

export function useSceneMotion(root: RefObject<HTMLElement>, scene: string) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (!root.current || reduced) return;
    const context = gsap.context(() => {
      gsap.from(".page-heading .eyebrow, .page-heading h1, .page-heading p, .heading-actions", { y: 16, opacity: 0, stagger: .055, duration: .42, ease: "power3.out", clearProps: "transform,opacity" });
      gsap.from(".flow-picker > button, .pipeline-node, .participant-journey, .participant-context, .experiment-intro", { y: 14, opacity: 0, stagger: .045, duration: .45, delay: .1, ease: "power3.out", clearProps: "transform,opacity" });
    }, root);
    const arrows = new Set<Element>();
    const interact = (event: Event, leave: boolean) => {
      const button = (event.target as Element).closest?.(".button");
      const arrow = button?.querySelector("svg");
      if (!arrow) return;
      arrows.add(arrow);
      gsap.to(arrow, { x: leave ? 0 : 4, duration: .2, ease: "power2.out", overwrite: true });
    };
    const enter = (event: Event) => interact(event, false);
    const leave = (event: Event) => interact(event, true);
    const scope = root.current;
    scope.addEventListener("pointerover", enter);
    scope.addEventListener("pointerout", leave);
    scope.addEventListener("focusin", enter);
    scope.addEventListener("focusout", leave);
    return () => {
      scope.removeEventListener("pointerover", enter);
      scope.removeEventListener("pointerout", leave);
      scope.removeEventListener("focusin", enter);
      scope.removeEventListener("focusout", leave);
      arrows.forEach((arrow) => { gsap.killTweensOf(arrow); gsap.set(arrow, { clearProps: "transform" }); });
      context.revert();
    };
  }, [root, scene, reduced]);
}

export function useQueueMotion(root: RefObject<HTMLElement>, running: boolean, fault: string) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (reduced || !root.current || !running || fault === "outage") return;
    const context = gsap.context(() => {
      gsap.fromTo(".pipeline-wire > i", { x: 0, opacity: 0 }, { x: 25, opacity: 1, duration: fault === "slow" ? 2.6 : 1.05, stagger: .2, ease: "none", repeat: -1, repeatDelay: .2 });
      gsap.to(".gate-status .w-pill > i", { opacity: .35, duration: .85, yoyo: true, repeat: -1, ease: "sine.inOut" });
    }, root);
    return () => context.revert();
  }, [root, running, fault, reduced]);
}

export function useSpotMotion(root: RefObject<HTMLElement>, resources: Resource[], queue: string) {
  const previous = useRef(new Map<number, string>());
  const previousQueue = useRef(queue);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (previousQueue.current !== queue) { previous.current.clear(); previousQueue.current = queue; }
    const changed = new Set(resources.filter((spot) => previous.current.has(spot.id) && previous.current.get(spot.id) !== spot.status).map((spot) => spot.id));
    previous.current = new Map(resources.map((spot) => [spot.id, spot.status]));
    if (reduced || !root.current || !changed.size) return;
    const elements = [...root.current.querySelectorAll<HTMLElement>("[data-spot]")].filter((element) => changed.has(Number(element.dataset.spot)));
    const tween = gsap.fromTo(elements, { scale: .8, opacity: .5 }, { scale: 1, opacity: 1, duration: .38, ease: "back.out(1.6)", stagger: .015, clearProps: "transform,opacity" });
    return () => { tween.kill(); gsap.set(elements, { clearProps: "transform,opacity" }); };
  }, [root, resources, queue, reduced]);
}

export function useJourneyMotion(root: RefObject<HTMLElement>, phase: string) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (reduced || !root.current) return;
    const context = gsap.context(() => {
      gsap.from(".journey-steps .current > span", { scale: .7, duration: .4, ease: "back.out(2)", clearProps: "transform" });
      gsap.from(".participant-journey > h2, .participant-position, .reservation-clock, .participant-receipt, .success-symbol", { y: 14, opacity: 0, duration: .4, stagger: .06, ease: "power3.out", clearProps: "transform,opacity" });
      if (phase === "confirmed") gsap.fromTo(".celebration-bit", { x: 0, y: 0, opacity: 1, scale: .4 }, { x: (index) => Math.cos(index * Math.PI / 4) * 90, y: (index) => Math.sin(index * Math.PI / 4) * 70, opacity: 0, scale: 1, rotation: 150, duration: .8, ease: "power2.out", delay: .15 });
    }, root);
    return () => context.revert();
  }, [root, phase, reduced]);
}

export function useActivityMotion(root: RefObject<HTMLElement>, ids: string[]) {
  const previous = useRef(new Set<string>());
  const reduced = useReducedMotion();
  const signature = ids.join("|");
  useLayoutEffect(() => {
    const fresh = new Set(ids.filter((id) => !previous.current.has(id)));
    previous.current = new Set(ids);
    if (!root.current || reduced || !fresh.size) return;
    const elements = [...root.current.querySelectorAll<HTMLElement>("[data-event-id]")].filter((element) => fresh.has(element.dataset.eventId ?? "")).slice(0, 5);
    const tween = gsap.from(elements, { x: -12, opacity: 0, duration: .35, stagger: .045, ease: "power2.out", clearProps: "transform,opacity" });
    return () => { tween.kill(); gsap.set(elements, { clearProps: "transform,opacity" }); };
  // The signature changes only when the visible events change, not on clock ticks.
  }, [root, signature, reduced]);
}
