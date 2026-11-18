const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const extension = path.resolve(__dirname, '..');
const review = (id, name, type = 'Official Review', children = '', title = 'A custom review title') => `
  <div class="note" data-id="${id}">
    <div class="collapse-controls-v"><button>−</button><button>＝</button><button onclick="this.closest('.note').dataset.expanded='true'">≡</button></div>
    <div class="heading"><h4>${title}</h4></div>
    <div class="subheading"><span class="invitation">${type}</span><span class="signatures">by ${name}</span></div>
    <p>Review content</p><div class="note-replies">${children}</div>
  </div>`;

test('Chrome extension: review discovery, updates, navigation and collapse', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openreview-toc-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://openreview.net/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>OpenReview fixture</title>
        <style>body{font:16px system-ui;margin:60px auto;max-width:850px;background:#fafafa}
        .note{padding:24px;margin:16px 0;border:1px solid #ddd;background:white;min-height:280px}
        .subheading{color:#56735e;font-size:14px}.invitation{margin-right:10px}</style></head><body>
        <h1>OpenReview · Reviewer TOC</h1><p>Browser integration test</p>
        <div style="height:500px"></div>
        ${review('a', 'Reviewer Alpha', 'Official Review',
          review('comment', 'Authors', 'Official Comment',
            review('followup', 'Reviewer Alpha', 'Official Comment', '', 'Thanks for the clarification'), 'Response to Q1')
          + review('comment2', 'Authors', 'Official Comment', '', 'Additional experiments'))}
        ${review('meta', 'Area Chair', 'Meta Review', review('meta-comment', 'Authors', 'Official Comment'))}
        ${review('unrelated', 'Authors', 'Official Comment')}
        ${review('b', 'Reviewer Beta', 'Review')}
        <div class="note" data-id="parent"><div class="note-replies">${review('c', 'Reviewer Gamma')}</div></div>
        <div class="note_with_children collapsed"><a class="expand-link" href="#" onclick="event.preventDefault();this.parentElement.classList.remove('collapsed')">+</a>
          <div class="note panel" id="note_legacy"><h2 class="note_content_title">Custom title</h2>
          <span class="signatures">Anonymous Reviewer 4</span><div class="meta_row"><span class="item">ICLR 2022 Conference Paper1 Official Review</span></div></div>
          <div class="children"><div class="note_with_children"><div class="note panel" id="note_legacy-reply">
            <h2 class="note_content_title">Response to reviewer 4</h2><span class="signatures">Authors</span>
            <div class="meta_row"><span class="item">Official Comment</span></div>
          </div></div></div>
        </div><div style="height:900px"></div></body></html>`,
    }));
    await page.goto('https://openreview.net/forum?id=paper');
    const toc = page.locator('#openreview-reviewer-toc');
    const buttons = toc.locator('.entry');
    const roots = toc.locator('#body > ol > li > .entry');
    const beta = toc.locator('.entry[data-note-id="b"]');
    await roots.nth(3).waitFor();
    assert.deepEqual(await roots.locator('.label').allTextContents(),
      ['Reviewer Alpha', 'Reviewer Beta', 'Reviewer Gamma', 'Anonymous Reviewer 4']);
    assert.equal(await buttons.count(), 8);
    assert.equal(await toc.locator('#count').textContent(), '4 位 · 4 条回复');
    assert.equal(await toc.locator('.entry[data-note-id="a"]').evaluate(el =>
      el.parentElement.querySelectorAll(':scope > ol > li').length), 2);
    const followup = toc.locator('.entry[data-note-id="followup"]');
    assert.equal(await followup.locator('.reply-title').textContent(), 'Thanks for the clarification');
    assert.equal(await followup.evaluate(el => el.parentElement.parentElement.parentElement.querySelector(':scope > button').dataset.noteId), 'comment');
    await followup.click();
    await page.waitForTimeout(50);
    assert.ok(Math.abs(await page.locator('[data-id="followup"]').evaluate(el => el.getBoundingClientRect().top) - 80) < 2);
    for (const id of ['a', 'comment', 'followup']) {
      assert.equal(await page.locator(`[data-id="${id}"]`).getAttribute('data-expanded'), 'true');
    }

    await beta.click();
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-id="b"]').getBoundingClientRect().top - 80) < 2);
    assert.ok(Math.abs(await page.locator('[data-id="b"]').evaluate(el => el.getBoundingClientRect().top) - 80) < 2);
    assert.equal(await beta.getAttribute('aria-current'), 'location');
    assert.equal(await page.locator('[data-id="b"]').getAttribute('data-expanded'), 'true');

    await toc.locator('.entry[data-note-id="legacy-reply"]').click();
    assert.equal(await page.locator('.note_with_children.collapsed').count(), 0);
    await page.waitForTimeout(50);
    assert.ok(Math.abs(await page.locator('#note_legacy-reply').evaluate(el => el.getBoundingClientRect().top) - 80) < 2);
    await toc.locator('#toggle').click();
    assert.equal(await toc.locator('#body').isVisible(), false);
    await toc.locator('#toggle').click();

    // React can replace a note while retaining the same id and signature.
    await page.locator('[data-id="b"]').evaluate(el => el.replaceWith(el.cloneNode(true)));
    await page.waitForTimeout(250);
    await beta.click();
    await page.waitForTimeout(50);
    assert.ok(Math.abs(await page.locator('[data-id="b"]').evaluate(el => el.getBoundingClientRect().top) - 80) < 2);

    // A collapsed note loses its invitation; keep the previously identified review.
    await page.locator('[data-id="b"]').evaluate(el => {
      el.innerHTML = '<div class="heading"><h4 class="minimal-title"><strong>Custom title</strong><span class="signatures">by Reviewer Beta</span></h4></div>';
    });
    await page.waitForTimeout(250);
    assert.equal(await buttons.count(), 8);

    await page.locator('[data-id="comment2"] .heading h4').evaluate(el => el.textContent = 'Updated experiments');
    await page.locator('[data-id="comment2"] > .note-replies').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html),
      review('new-reply', 'Reviewer Alpha', 'Official Comment', '', 'Follow-up question'));
    await toc.locator('.entry[data-note-id="new-reply"]').waitFor();
    assert.equal(await toc.locator('.entry[data-note-id="comment2"] .reply-title').textContent(), 'Updated experiments');
    assert.equal(await buttons.count(), 9);

    await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), review('d', '&lt;img src=x onerror=alert(1)&gt;'));
    const delta = toc.locator('.entry[data-note-id="d"]');
    await delta.waitFor();
    assert.equal(await delta.locator('img').count(), 0);
    assert.match(await delta.textContent(), /<img/);
    await page.locator('[data-id="d"] .signatures').evaluate(el => el.textContent = 'by Reviewer Delta');
    await page.locator('[data-id="a"]').evaluate(el => el.style.display = 'none');
    await page.waitForTimeout(250);
    assert.equal(await buttons.count(), 5);
    assert.equal(await toc.locator('.entry[data-note-id="comment"]').count(), 0);
    await page.locator('[data-id="a"]').evaluate(el => el.style.display = '');
    await toc.locator('.entry[data-note-id="followup"]').waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await toc.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    fs.mkdirSync(path.join(extension, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(extension, 'test-results/mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(extension, 'test-results/desktop.png') });

    await page.evaluate(() => {
      history.pushState({}, '', '/forum?id=another');
      document.querySelectorAll('.note').forEach(el => el.remove());
    });
    await toc.locator('#empty').waitFor();
    assert.equal(await buttons.count(), 0);
    await page.evaluate(() => { history.pushState({}, '', '/group?id=ICLR'); dispatchEvent(new PopStateEvent('popstate')); });
    assert.equal(await toc.isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
