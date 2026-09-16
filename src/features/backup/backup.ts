import { backupSchema, type Dataset } from '../../domain/schema';

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export function parseBackup(
  text: string,
  bytes = new TextEncoder().encode(text).byteLength,
): Dataset {
  if (bytes > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 5 MB limit.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. The original data has not been changed.');
  }
  const result = backupSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      `Invalid backup: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return result.data;
}

export function serializeBackup(dataset: Dataset): string {
  return JSON.stringify(backupSchema.parse(dataset), null, 2);
}

function csvCell(value: string): string {
  // Neutralize spreadsheet formulas in user-controlled notes.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function attendanceCSV(dataset: Dataset): string {
  const lines = [
    ['date', 'type', 'status', 'priority', 'notes'],
    ...[...dataset.records]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => [entry.date, entry.type, entry.status, entry.priority, entry.notes]),
  ];
  return lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function download(content: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
