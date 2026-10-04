/**
 * Toast store — framework-agnostic event emitter + `toast()` API.
 *
 * NOTE: this module has NO "use client" directive on purpose, so `toast()`
 * can be imported from Server Components and route-adjacent code. Rendering
 * is handled by `<Toaster />` (components/ui/toaster.tsx, client).
 */

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss after ms. `0` or negative = sticky. Default 4500. */
  duration?: number;
  action?: ToastAction;
}

export interface ToastItem extends Required<Omit<ToastOptions, "action" | "description">> {
  id: string;
  description?: string;
  action?: ToastAction;
  createdAt: number;
}

type Listener = (toasts: ToastItem[]) => void;

const listeners = new Set<Listener>();
let toasts: ToastItem[] = [];
let counter = 0;

function emit() {
  const snapshot = [...toasts];
  listeners.forEach((listener) => listener(snapshot));
}

function addToast(options: ToastOptions): string {
  const id = `toast-${Date.now()}-${counter++}`;
  const item: ToastItem = {
    id,
    title: options.title,
    description: options.description,
    variant: options.variant ?? "default",
    duration: options.duration ?? 4500,
    action: options.action,
    createdAt: Date.now(),
  };
  toasts = [...toasts.slice(-4), item]; // cap stack at 5
  emit();
  return id;
}

/**
 * Show a toast. Returns the toast id (pass to `dismissToast`).
 * Safe to call from anywhere — server components, event handlers, effects.
 */
export function toast(options: ToastOptions): string {
  return addToast(options);
}

toast.success = (title: string, options?: Omit<ToastOptions, "title" | "variant">) =>
  addToast({ ...options, title, variant: "success" });
toast.error = (title: string, options?: Omit<ToastOptions, "title" | "variant">) =>
  addToast({ ...options, title, variant: "error" });
toast.warning = (title: string, options?: Omit<ToastOptions, "title" | "variant">) =>
  addToast({ ...options, title, variant: "warning" });
toast.info = (title: string, options?: Omit<ToastOptions, "title" | "variant">) =>
  addToast({ ...options, title, variant: "info" });

/** Remove a toast by id. */
export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Remove all toasts. */
export function clearToasts(): void {
  toasts = [];
  emit();
}

/** Subscribe to toast state (used by `<Toaster />`). Returns unsubscribe. */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}
