"use client";

import { useState, useEffect, useCallback } from "react";
import { callApi } from "@/lib/client";

/**
 * Hook that calls getAllData and caches the heterogeneous `data` array in
 * component state. Re-fetches on demand via `reload()`.
 */
export function useAllData() {
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await callApi("getAllData");
    if (result.isOk) {
      setData((result as { data?: Record<string, unknown>[] }).data ?? []);
    } else {
      setError((result as { error?: string }).error || "Failed to load data");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

/** Filter the heterogeneous data array by `type`. */
export function byType<T = Record<string, unknown>>(
  data: Record<string, unknown>[],
  type: string
): T[] {
  return data.filter((d) => d.type === type) as T[];
}
