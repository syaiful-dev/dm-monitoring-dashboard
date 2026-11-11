// DM Monitoring Dashboard — Searchable Select
// Turns a native <select> into a type-to-search + click-to-select combobox.
// The original <select> stays in the DOM (hidden) and keeps its value + change events,
// so existing code that reads select.value or listens to 'change' keeps working.

const SearchableSelect = (() => {
  /**
   * Enhance a <select> element into a searchable combobox.
   * Safe to call multiple times — it won't double-enhance.
   * @param {string} selectId - id of the native <select>
   */
  function enhance(selectId) {
    const select = document.getElementById(selectId);
    if (!select || select.dataset.enhanced === '1') return;
    select.dataset.enhanced = '1';

    // Hide the native select but keep it for value/change wiring
    select.style.display = 'none';

    // Build wrapper + input + dropdown list
    const wrap = document.createElement('div');
    wrap.className = 'ss-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ss-input filter-select';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = 'Type or select...';

    // Clickable dropdown arrow
    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'ss-caret';
    caret.setAttribute('tabindex', '-1');
    caret.setAttribute('aria-label', 'Toggle list');
    caret.innerHTML = '▾';

    const list = document.createElement('div');
    list.className = 'ss-list';
    list.style.display = 'none';

    wrap.appendChild(input);
    wrap.appendChild(caret);
    wrap.appendChild(list);
    select.parentNode.insertBefore(wrap, select.nextSibling);

    let activeIndex = -1;

    function options() {
      return Array.from(select.options).map(o => ({ value: o.value, label: o.textContent }));
    }

    // Show the label of the currently selected option in the input
    function syncInputFromSelect() {
      const opt = select.options[select.selectedIndex];
      input.value = opt ? opt.textContent : '';
    }

    function renderList(filter) {
      const f = (filter || '').toLowerCase();
      const matches = options().filter(o => o.label.toLowerCase().includes(f));
      list.innerHTML = '';
      activeIndex = -1;

      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ss-empty';
        empty.textContent = 'No matches';
        list.appendChild(empty);
        return;
      }

      matches.forEach(o => {
        const item = document.createElement('div');
        item.className = 'ss-item';
        item.textContent = o.label;
        item.dataset.value = o.value;
        if (o.value === select.value) item.classList.add('selected');
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus, avoid blur before click
          choose(o.value, o.label);
        });
        list.appendChild(item);
      });
    }

    function open() {
      renderList(''); // show all on open
      list.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
      input.select();
    }

    function close() {
      list.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
      syncInputFromSelect(); // restore label if user typed but didn't pick
    }

    function choose(value, label) {
      select.value = value;
      input.value = label;
      close();
      // Fire native change so existing listeners run
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function visibleItems() {
      return Array.from(list.querySelectorAll('.ss-item'));
    }

    function setActive(idx) {
      const items = visibleItems();
      if (items.length === 0) return;
      activeIndex = (idx + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function isOpen() {
      return list.style.display === 'block';
    }

    // --- events ---
    input.addEventListener('focus', open);

    // Caret toggles the full list open/closed (dropdown behavior)
    caret.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't steal focus / trigger input blur
      if (isOpen()) {
        close();
      } else {
        input.focus();
        open();
      }
    });

    input.addEventListener('input', () => {
      list.style.display = 'block';
      renderList(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (list.style.display === 'none' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        open();
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const items = visibleItems();
        if (activeIndex >= 0 && items[activeIndex]) {
          choose(items[activeIndex].dataset.value, items[activeIndex].textContent);
        }
      } else if (e.key === 'Escape') {
        close();
        input.blur();
      }
    });

    // Close when clicking outside
    document.addEventListener('mousedown', (e) => {
      if (!wrap.contains(e.target)) close();
    });

    // Keep input label in sync if other code changes select.value programmatically
    select.addEventListener('change', syncInputFromSelect);

    syncInputFromSelect();
  }

  return { enhance };
})();

window.SearchableSelect = SearchableSelect;
