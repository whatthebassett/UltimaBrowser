// Ultima's own dropdowns. Every <select> in the UI keeps its options and value (so the code using it is unchanged),
// but opens this menu instead of the system's: a frosted panel hanging from the field, the current choice marked
// with an accent bar and a check, keyboard navigation (arrows, Home/End, Enter, Esc, type to jump) and a choice
// reported as an ordinary change event. The closed field is styled in styles.css (select.field). An option can show
// itself in a font (data-font), and a disabled one can head the options after it (data-heading).
const DD = { open: null }; // { select, layer, menu, items, active }

function openDropdown(select) {
  closeDropdown();
  const options = [...select.options];
  if (!options.length) return;
  const layer = h('<div class="dd-layer"></div>');
  const menu = h(`<div class="dd-menu" role="listbox">${options.map((o, i) => `
    <div class="dd-item ${o.selected ? 'on' : ''} ${o.disabled ? 'disabled' : ''} ${'heading' in o.dataset ? 'dd-heading' : ''}" data-i="${i}" role="option" aria-selected="${o.selected}">
      <span class="dd-label" ${o.dataset.font ? `style="font-family: ${esc(o.dataset.font)}"` : ''}>${esc(o.textContent)}</span><span class="dd-check">${o.selected ? icon('check', 14) : ''}</span>
    </div>`).join('')}</div>`);
  layer.append(menu);
  document.body.append(layer);
  DD.open = { select, layer, menu, items: [...menu.children], active: Math.max(0, select.selectedIndex) };
  select.classList.add('dd-open');

  // hangs from the field, as wide as it at least; opens upward when there's no room below
  const r = select.getBoundingClientRect();
  menu.style.minWidth = `${r.width}px`;
  const mr = menu.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 8;
  const up = below < Math.min(mr.height, 240) && r.top > below;
  menu.style.maxHeight = `${Math.max(120, (up ? r.top : below) - 12)}px`;
  menu.style.left = `${Math.max(6, Math.min(r.left, window.innerWidth - mr.width - 6))}px`;
  if (up) { menu.style.bottom = `${window.innerHeight - r.top + 6}px`; menu.classList.add('up'); } else menu.style.top = `${r.bottom + 6}px`;
  markActive(DD.open.active, true);

  layer.addEventListener('mousedown', (e) => { if (e.target === layer) { e.preventDefault(); closeDropdown(); } });
  menu.addEventListener('mousemove', (e) => { const it = e.target.closest('.dd-item'); if (it) markActive(Number(it.dataset.i)); });
  menu.addEventListener('mousedown', (e) => e.preventDefault()); // the field keeps focus
  menu.addEventListener('click', (e) => { const it = e.target.closest('.dd-item'); if (it) chooseDropdown(Number(it.dataset.i)); });
}

function markActive(i, scroll = false) {
  const d = DD.open;
  if (!d || !d.items[i]) return;
  d.items[d.active]?.classList.remove('active');
  d.active = i;
  d.items[i].classList.add('active');
  if (scroll) d.items[i].scrollIntoView({ block: 'nearest' });
}

function chooseDropdown(i) {
  const d = DD.open;
  const opt = d?.select.options[i];
  if (!opt || opt.disabled) return;
  const changed = d.select.selectedIndex !== i;
  closeDropdown();
  if (!changed) return;
  d.select.selectedIndex = i;
  d.select.dispatchEvent(new Event('input', { bubbles: true }));
  d.select.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeDropdown() {
  const d = DD.open;
  if (!d) return;
  DD.open = null;
  d.select.classList.remove('dd-open');
  d.layer.remove();
}

// the next option that can be chosen, going `dir` from `i`
function stepOption(select, i, dir) {
  const opts = select.options;
  for (let j = i + dir; j >= 0 && j < opts.length; j += dir) if (!opts[j].disabled) return j;
  return i;
}

function onDropdownKey(e) {
  const d = DD.open;
  if (!d) return;
  const { select } = d;
  const n = select.options.length;
  if (e.key === 'ArrowDown') markActive(stepOption(select, d.active, 1), true);
  else if (e.key === 'ArrowUp') markActive(stepOption(select, d.active, -1), true);
  else if (e.key === 'Home') markActive(stepOption(select, -1, 1), true);
  else if (e.key === 'End') markActive(stepOption(select, n, -1), true);
  else if (e.key === 'Enter' || e.key === ' ') chooseDropdown(d.active);
  else if (e.key === 'Escape' || e.key === 'Tab') { closeDropdown(); if (e.key === 'Tab') return; }
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    // type to jump: the next option starting with that letter
    const k = e.key.toLowerCase();
    for (let s = 1; s <= n; s += 1) {
      const j = (d.active + s) % n;
      if (!select.options[j].disabled && select.options[j].textContent.trim().toLowerCase().startsWith(k)) { markActive(j, true); break; }
    }
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

function initDropdowns() {
  // the system's popup never opens: a press on any <select> opens ours instead
  document.addEventListener('mousedown', (e) => {
    const select = e.target.closest?.('select');
    if (!select || e.button !== 0 || select.disabled || select.multiple || select.size > 1) return;
    e.preventDefault();
    select.focus();
    if (DD.open?.select === select) closeDropdown(); else openDropdown(select);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (DD.open) { onDropdownKey(e); return; }
    const select = e.target.closest?.('select');
    if (!select || select.disabled || select.multiple) return;
    // the keys that would open the system's popup open ours
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
      e.preventDefault();
      openDropdown(select);
    }
  }, true);
  // anything that moves the field away closes the menu
  window.addEventListener('resize', closeDropdown);
  window.addEventListener('blur', closeDropdown);
  document.addEventListener('scroll', (e) => { if (DD.open && !DD.open.menu.contains(e.target)) closeDropdown(); }, true);
}
