"use client";

import { createContext, useContext, useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

export const SessionDraftUser = createContext("");
function scopedKey(user:string,key:string){return user ? JSON.stringify([user,key]) : key;}
export function useClearSessionDraft(){const user=useContext(SessionDraftUser);return useCallback((key:string)=>clearSessionDraft(scopedKey(user,key)),[user]);}

const PREFIX = "wb-sklad-ui:";
const listeners = new Map<string, Set<() => void>>();
const parsedByKey = new Map<string, { raw: string; value: unknown }>();

function subscribeKey(key: string, onChange: () => void) {
  let bucket = listeners.get(key);
  if (!bucket) {
    bucket = new Set();
    listeners.set(key, bucket);
  }
  bucket.add(onChange);
  return () => {
    bucket.delete(onChange);
  };
}

function notify(key: string) {
  listeners.get(key)?.forEach((listener) => listener());
}

function storageKey(key: string) {
  return PREFIX + key;
}

function readRaw(key: string): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
}

export function parseDraft<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function keepExistingIds(ids: string[], existing: Iterable<string>) {
  const known = existing instanceof Set ? existing : new Set(existing);
  return ids.filter((id) => known.has(id));
}

export function clearSessionDraft(key: string) {
  parsedByKey.delete(key);
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey(key));
  } catch {
    /* ignore quota / private mode */
  }
  notify(key);
}

const subscribeHydration=()=>()=>{};
const clientReady=()=>true,serverReady=()=>false;
export function useSessionHydrated(){return useSyncExternalStore(subscribeHydration,clientReady,serverReady);}

export function useSessionDraft<T>(unscopedKey: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const user=useContext(SessionDraftUser);
  const key=scopedKey(user,unscopedKey);
  const hydrated = useSessionHydrated();
  const raw = useSyncExternalStore(
    (onStoreChange) => subscribeKey(key, onStoreChange),
    () => (hydrated ? readRaw(key) : null),
    () => null,
  );

  let value: T;
  if (raw == null) {
    value = fallback;
  } else {
    const cached = parsedByKey.get(key);
    if (cached && cached.raw === raw) {
      value = cached.value as T;
    } else {
      value = parseDraft(raw, fallback);
      parsedByKey.set(key, { raw, value });
    }
  }

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (update) => {
      const current = parseDraft(readRaw(key), fallback);
      const next = typeof update === "function" ? (update as (prev: T) => T)(current) : update;
      try {
        if (typeof sessionStorage !== "undefined") {
          const json = JSON.stringify(next);
          sessionStorage.setItem(storageKey(key), json);
          parsedByKey.set(key, { raw: json, value: next });
        }
      } catch {
        /* ignore quota / private mode */
      }
      notify(key);
    },
    [fallback, key],
  );

  return [value, setValue];
}
