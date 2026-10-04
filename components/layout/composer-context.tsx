/**
 * components/layout/composer-context.tsx — global "Create post" composer state.
 *
 * The sidebar / mobile nav "Create" buttons open one shared PostComposer
 * dialog rendered by AppShell, so it works from any page.
 */
"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ComposerContextValue {
  composerOpen: boolean;
  openComposer: () => void;
  closeComposer: () => void;
}

const ComposerContext = createContext<ComposerContextValue>({
  composerOpen: false,
  openComposer: () => undefined,
  closeComposer: () => undefined,
});

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const openComposer = useCallback(() => setComposerOpen(true), []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);

  return (
    <ComposerContext.Provider value={{ composerOpen, openComposer, closeComposer }}>
      {children}
    </ComposerContext.Provider>
  );
}

export function useComposer(): ComposerContextValue {
  return useContext(ComposerContext);
}
