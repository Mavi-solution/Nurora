"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DayStatusMap } from "./date-field";

/**
 * Availability colours for whichever month the calendar is showing.
 *
 * Kept as a hook because three screens want the same thing and each
 * would otherwise grow its own fetch, its own race condition and its
 * own idea of when to give up. Months already fetched are remembered
 * for the life of the component: flicking back and forth between
 * September and October should not re-query on every click.
 *
 * `key` is anything that invalidates the whole cache — the counsellor,
 * the language, the service length. Change it and every month is
 * refetched, because the answer genuinely is different.
 */
export function useMonthAvailability(params: {
  /** Skip fetching entirely — e.g. an Interest, which books no slot. */
  enabled?: boolean;
  counsellorId?: string;
  specialismId?: string;
  language?: string;
  durationMinutes?: number;
}) {
  const {
    enabled = true,
    counsellorId,
    specialismId,
    language,
    durationMinutes,
  } = params;

  const [status, setStatus] = useState<DayStatusMap>({});
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<string | null>(null);

  const key = [
    counsellorId ?? "",
    specialismId ?? "",
    language ?? "",
    durationMinutes ?? "",
  ].join("|");

  const cache = useRef(new Map<string, DayStatusMap>());
  const lastKey = useRef(key);

  if (lastKey.current !== key) {
    lastKey.current = key;
    cache.current = new Map();
  }

  const onMonthChange = useCallback((monthKey: string) => {
    setMonth(monthKey);
  }, []);

  useEffect(() => {
    if (!enabled || !month) return;

    const cacheKey = `${key}::${month}`;
    const hit = cache.current.get(cacheKey);
    if (hit) {
      setStatus(hit);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const search = new URLSearchParams({ month });
    if (counsellorId) search.set("counsellor", counsellorId);
    if (specialismId) search.set("specialism", specialismId);
    if (language) search.set("language", language);
    if (durationMinutes) search.set("duration", String(durationMinutes));

    fetch(`/api/availability-month?${search}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const next = (data.status ?? {}) as DayStatusMap;
        cache.current.set(cacheKey, next);
        setStatus(next);
      })
      // A calendar with no colours is still a working calendar, so a
      // failure here degrades rather than surfacing an error the desk
      // can do nothing about.
      .catch(() => {
        if (!cancelled) setStatus({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, month, key, counsellorId, specialismId, language, durationMinutes]);

  return { status: enabled ? status : {}, loading, onMonthChange };
}
