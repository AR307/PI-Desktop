import { useEffect, useRef, type ReactNode } from "react";
import { portalOverlay } from "../../components/ui";

/** Native dialog supplies modal focus containment and keyboard restoration. */
export function AccountDialog({ title, children, onCancel }: {
  title: string; children: ReactNode; onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return portalOverlay(
    <dialog ref={ref} className="mirrorcoding-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2>{title}</h2>
      {children}
    </dialog>,
  );
}
