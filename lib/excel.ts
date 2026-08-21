"use client";

// ============================================================================
// SheetJS (xlsx) dynamic loader — injects the CDN script tag once and resolves
// with the global XLSX object. No npm dependency; mirrors the legacy app which
// loaded SheetJS via a <script> tag.
// ============================================================================

const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

/** Minimal shape of the SheetJS API we use. */
export interface SheetJs {
  utils: {
    book_new: () => unknown;
    json_to_sheet: (rows: Record<string, unknown>[]) => { "!cols"?: Array<{ wch: number }> };
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
  writeFile: (wb: unknown, filename: string) => void;
}

declare global {
  interface Window { XLSX?: SheetJs }
}

let loadPromise: Promise<SheetJs> | null = null;

/** Load SheetJS from the CDN (once) and return the global XLSX object. */
export function loadSheetJs(): Promise<SheetJs> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SheetJS can only load in the browser"));
  }
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<SheetJs>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.async = true;
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX);
      else reject(new Error("SheetJS failed to initialize"));
    };
    script.onerror = () => {
      loadPromise = null; // allow retry on next click
      reject(new Error("Failed to load Excel library — check your connection"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
