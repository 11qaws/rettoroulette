/**
 * Produces one quoted CSV field without letting a pasted display name become
 * an Excel/Sheets formula when the broadcaster opens the exported file.
 */
export function csvField(value: string | number | undefined | null) {
  const text = String(value ?? '');
  const formulaSafe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;

  return `"${formulaSafe.replaceAll('"', '""')}"`;
}
