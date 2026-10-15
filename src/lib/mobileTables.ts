function label(table: HTMLTableElement) {
  if (table.dataset.noCards !== undefined) return;
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return;
  const names: string[] = [];
  Array.from(head.cells).forEach((th) => {
    for (let i = 0; i < (th.colSpan || 1); i++) names.push((th.textContent || '').trim());
  });
  table.classList.add('m-cards');
  Array.from(table.tBodies).forEach((tb) => Array.from(tb.rows).forEach((tr) => {
    let col = 0;
    Array.from(tr.cells).forEach((td) => {
      const name = td.colSpan > 1 ? '' : names[col] || '';
      if (td.getAttribute('data-label') !== name) td.setAttribute('data-label', name);
      col += td.colSpan || 1;
    });
  }));
}

export function startMobileTables() {
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll('table').forEach((t) => label(t as HTMLTableElement));
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}
