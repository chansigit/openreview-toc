(() => {
  const host = document.createElement('div');
  host.id = 'openreview-reviewer-toc';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; z-index: 10000; top: 104px; right: 16px;
        width: 280px; max-width: calc(100vw - 32px); color: #24312c;
        font: 14px/1.5 system-ui, sans-serif; color-scheme: light; }
      :host([hidden]) { display: none; }
      * { box-sizing: border-box; }
      nav { background: #fff; border: 1px solid #dce5df; border-radius: 12px;
        box-shadow: 0 5px 24px #172e1f14; overflow: hidden; display: flex;
        flex-direction: column; max-height: calc(100vh - 16px); }
      button { font: inherit; cursor: pointer; }
      #toggle { width: 100%; display: flex; align-items: center; gap: 8px; padding: 14px;
        border: 0; background: #f5f8f6; color: inherit; text-align: left;
        cursor: grab; touch-action: none; user-select: none; flex-shrink: 0; }
      #toggle:active { cursor: grabbing; }
      #count { color: #66766c; font-size: 12px; }
      #chevron { margin-left: auto; }
      #body { max-height: calc(100vh - 210px); overflow-y: auto; padding: 8px; }
      ol { list-style: none; padding: 0; margin: 0; }
      ol ol { margin-left: 10px; padding-left: 6px; border-left: 1px solid #dce5df; }
      .entry { display: flex; align-items: baseline; gap: 10px; width: 100%; border: 0;
        border-radius: 7px; background: transparent; color: #34483b; padding: 10px;
        text-align: left; overflow-wrap: anywhere; }
      .entry:hover, .entry[aria-current] { background: #eaf3ed; color: #17643b; }
      .number { color: #85938a; font-size: 11px; flex-shrink: 0; }
      .label { min-width: 0; }
      .reply-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
        overflow: hidden; color: #6e7c73; font-size: 12px; margin-top: 2px; }
      button:focus-visible { outline: 2px solid #27804d; outline-offset: -2px; }
      #empty { margin: 8px; color: #6e7c73; font-size: 12px; }
      @media (max-width: 1450px) { :host { top: auto; bottom: 20px; }
        #body { max-height: 40vh; } }
      @media print { :host { display: none; } }
    </style>
    <nav aria-label="审稿人目录">
      <button id="toggle" type="button" aria-expanded="true" aria-controls="body"
        title="拖动调整位置，点击折叠；聚焦后可用方向键移动">
        <strong>审稿人目录</strong><span id="count"></span><span id="chevron" aria-hidden="true">−</span>
      </button>
      <div id="body"><ol></ol><p id="empty">暂无已加载的评审；请等待页面加载或检查筛选条件。</p></div>
    </nav>`;

  const toggle = root.querySelector('#toggle');
  const body = root.querySelector('#body');
  const list = root.querySelector('ol');
  let drag;
  let suppressClick = false;

  function moveTo(x, y) {
    const bounds = host.getBoundingClientRect();
    Object.assign(host.style, {
      left: `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`,
      top: `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`,
      right: 'auto', bottom: 'auto',
    });
  }

  function keepInView() {
    if (host.hidden || !host.style.left) return;
    const bounds = host.getBoundingClientRect();
    moveTo(bounds.left, bounds.top);
  }

  toggle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = host.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: bounds.left, top: bounds.top, moved: false };
    suppressClick = false;
    toggle.setPointerCapture(event.pointerId);
  });
  toggle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    moveTo(drag.left + dx, drag.top + dy);
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    suppressClick = drag.moved;
    drag = null;
    if (toggle.hasPointerCapture(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
  }
  toggle.addEventListener('pointerup', endDrag);
  toggle.addEventListener('pointercancel', endDrag);
  toggle.addEventListener('lostpointercapture', endDrag);
  toggle.addEventListener('keydown', event => {
    const direction = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const bounds = host.getBoundingClientRect();
    moveTo(bounds.left + direction[0], bounds.top + direction[1]);
  });
  window.addEventListener('resize', keepInView);
  new ResizeObserver(keepInView).observe(host);

  toggle.addEventListener('click', event => {
    // A drag also generates a click; it must not collapse the panel.
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      return;
    }
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    root.querySelector('#chevron').textContent = body.hidden ? '+' : '−';
  });

  const noteSelector = '.note[data-id], .note[id^="note_"]';
  const knownReviews = new Map();
  let forum = '';
  let entries = [];
  let renderKey = '';
  let updateTimer;

  // Only read a note's own metadata, never a nested reply's signature.
  function own(note, selector) {
    return [...note.querySelectorAll(selector)].filter(el => el.closest(noteSelector) === note);
  }

  function text(el) {
    return el?.textContent.replace(/\s+/g, ' ').trim() || '';
  }

  function parentNote(note) {
    return note.parentElement.closest(noteSelector)
      || note.closest('.note_with_children')?.parentElement.closest('.note_with_children')?.querySelector(':scope > .note');
  }

  function update() {
    clearTimeout(updateTimer);
    const url = new URL(location.href);
    const currentForum = url.pathname === '/forum' ? url.searchParams.get('id') : null;
    host.hidden = !currentForum;
    if (!host.isConnected) document.body.append(host);
    if (forum !== currentForum) {
      knownReviews.clear();
      forum = currentForum;
      renderKey = '';
    }
    if (!currentForum) return;

    entries = [];
    const seen = new Set();
    const byNote = new Map();
    for (const note of document.querySelectorAll(noteSelector)) {
      const id = note.dataset.id || note.id.slice(5);
      if (id === forum || seen.has(id) || note.matches('.deleted, .trashed')) continue;
      if (note.closest('[hidden]') || getComputedStyle(note).display === 'none') continue;
      const invitation = text(own(note, '.invitation, .meta_row .highlight')[0]);
      const title = text(own(note, '.minimal-title strong')[0]
        || own(note, '.note_content_title, .heading h4')[0]);
      const legacyType = own(note, '.meta_row .item').map(text).find(value => /(?:^|\s)(?:Official )?Review$/i.test(value));
      const type = invitation || legacyType || title;
      // shortcut: relies on OpenReview's English review labels; extend if venues use other labels.
      const isReview = /^(?:Official )?Review(?:\s+(?:of|by)\b|$)/i.test(type) || Boolean(legacyType);
      const cached = knownReviews.get(id);
      const parent = byNote.get(parentNote(note));
      const review = isReview || (cached && !invitation && !legacyType);
      if (!review && !parent) continue;
      const signature = text(own(note, '.signatures')[0]).replace(/^by\s+/i, '')
        || invitation.match(/\sby\s(.+)$/i)?.[1];
      const label = signature || cached || (parent ? '回复者' : '审稿人');
      if (review) knownReviews.set(id, label);
      seen.add(id);
      const entry = { id, label, note, parentId: parent?.id, title: parent ? title || '回复' : '' };
      byNote.set(note, entry);
      entries.push(entry);
    }

    const key = JSON.stringify(entries.map(({ id, label, parentId, title }) => [id, label, parentId, title]));
    if (key === renderKey) return;
    renderKey = key;
    list.replaceChildren();
    const reviewCount = entries.filter(entry => !entry.parentId).length;
    root.querySelector('#count').textContent = `${reviewCount} 位 · ${entries.length - reviewCount} 条回复`;
    root.querySelector('#empty').hidden = entries.length > 0;
    const items = new Map();
    let reviewIndex = 0;
    entries.forEach(({ id, label, parentId, title }) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'entry';
      button.dataset.noteId = id;
      const number = document.createElement('span');
      number.className = 'number';
      number.setAttribute('aria-hidden', 'true');
      number.textContent = parentId ? '↳' : String(++reviewIndex).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'label';
      name.textContent = label;
      if (parentId) {
        const subtitle = document.createElement('span');
        subtitle.className = 'reply-title';
        subtitle.textContent = title;
        name.append(subtitle);
        button.title = `${label}: ${title}`;
      }
      button.append(number, name);
      button.addEventListener('click', () => jump(id));
      li.append(button);
      items.set(id, li);
      const parentItem = items.get(parentId);
      if (parentItem) {
        let replies = parentItem.querySelector(':scope > ol');
        if (!replies) {
          replies = document.createElement('ol');
          parentItem.append(replies);
        }
        replies.append(li);
      } else list.append(li);
    });
  }

  function jump(id) {
    const entry = entries.find(item => item.id === id);
    if (!entry?.note.isConnected) return;
    const { note } = entry;
    for (let parent = note.closest('.note_with_children'); parent; parent = parent.parentElement?.closest('.note_with_children')) {
      if (parent.matches('.collapsed, .semi-collapsed')) {
        parent.querySelector(':scope > .expand-link')?.click();
      }
    }
    for (let parent = note; parent; parent = parent.parentElement?.closest(noteSelector)) {
      parent.querySelector(':scope > .collapse-controls-v > button:last-child:not(.active)')?.click();
    }
    requestAnimationFrame(() => {
      update();
      const target = entries.find(item => item.id === id)?.note;
      if (!target) return;
      window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + scrollY - 80),
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      target.animate([{ outline: '2px solid #4d9666' }, { outline: '2px solid transparent' }], { duration: 1400 });
      root.querySelectorAll('.entry').forEach(button => {
        if (button.dataset.noteId === id) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      });
    });
  }

  new MutationObserver(records => {
    if (records.every(record => record.target === host)) return;
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 150);
  }).observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-id'] });
  window.addEventListener('popstate', update);
  update();
})();
