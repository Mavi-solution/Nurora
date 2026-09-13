/**
 * CSV for the admin exports.
 *
 * Values are quoted and embedded quotes doubled, per RFC 4180. A value
 * that begins with =, +, - or @ is prefixed with a single quote:
 * spreadsheets treat those as formulas, so a client note starting with
 * "=" would otherwise execute on open. These files contain names and
 * phone numbers typed in by callers, which is exactly the untrusted
 * input that makes CSV injection worth guarding against.
 */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
): string {
  const header = columns.map((c) => quote(c.label)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => quote(format(row[c.key]))).join(","),
  );
  return [header, ...body].join("\r\n");
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function quote(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Triggers a download in the browser. */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel read UTF-8 correctly — Tamil names in a client
  // list come out as mojibake without it.
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
