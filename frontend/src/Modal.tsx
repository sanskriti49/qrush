import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { gsap } from "gsap";
import { useReducedMotion } from "./motion";

export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef(`dialog-${Math.random().toString(36).slice(2)}`);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      const fallback = document.querySelector<HTMLButtonElement>(".mobile-menu");
      const target = focused && focused !== document.body && focused.getClientRects().length ? focused : fallback;
      target?.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (reduced || !ref.current) return;
    const context = gsap.context(() => {
      gsap.from(ref.current, { y: 18, scale: .96, opacity: 0, duration: .3, ease: "power3.out", clearProps: "transform,opacity" });
    });
    return () => context.revert();
  }, [reduced]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={heading.current}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) close();
      }}
    >
      <div className="modal-header">
        <h2 id={heading.current}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
