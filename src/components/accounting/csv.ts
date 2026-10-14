export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv = '\uFEFF' + rows.map((r) => r.map((v) => {
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  }).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
}
