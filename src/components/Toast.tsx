'use client';

import { createContext, useCallback, useContext, useState } from 'react';

export type ToastKind = 'ok' | 'info' | 'warn' | 'err';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastCtx {
  toast(text: string, kind?: ToastKind): void;
}

const Ctx = createContext<ToastCtx>({ toast: () => undefined });

let seq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = seq++;
    setItems((prev) => [...prev.slice(-3), { id, text, kind }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast-item ${t.kind}`}>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
