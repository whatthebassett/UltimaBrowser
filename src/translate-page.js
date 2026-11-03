// Translating a page, the part that runs in it (in a world of its own, apart from the page's scripts; main/pagetools.js
// runs it and sends the text to be translated). The page's text goes a block at a time: a paragraph, heading, list
// item or link with the formatting inside it, its links and bold words written as numbered tags (<g i=0>…</g>), which
// come back in place in the translated sentence. The block is put back together from its own elements, so links and
// buttons keep working, and restore() puts back exactly what was there. Text the page changes or adds afterwards is
// found again by the next collect().
(() => {
  if (window.__ultimaTr) return true;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'MATH', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'IMG', 'PICTURE']);
  const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DATA', 'DFN', 'EM', 'I', 'MARK', 'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'FONT', 'LABEL', 'INS', 'DEL']);
  // kept as they are inside a sentence: pictures, code, line breaks, form fields
  const ATOMIC = new Set(['BR', 'WBR', 'IMG', 'SVG', 'PICTURE', 'CODE', 'KBD', 'SAMP', 'VAR', 'INPUT', 'SELECT', 'BUTTON', 'TEXTAREA', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED']);
  const tagOf = (el) => el.tagName.toUpperCase();
  const noTranslate = (el) => el.translate === false || el.classList?.contains('notranslate') || el.isContentEditable;
  const kept = (el) => ATOMIC.has(tagOf(el)) || noTranslate(el);
  const words = (s) => /\p{L}/u.test(s);
  const inlineOnly = (el) => [...el.children].every((c) => ATOMIC.has(tagOf(c)) || (INLINE.has(tagOf(c)) && (noTranslate(c) || inlineOnly(c))));
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const squash = (s) => s.replace(/\s+/g, ' ');
  const st = { done: new WeakSet(), blocks: [], pending: [], on: false, max: 300 };

  // blocks of text not yet translated: an element holding only text and formatting, or loose text beside other blocks
  function visit(el, out) {
    if (out.length >= st.max || SKIP.has(tagOf(el)) || noTranslate(el) || !words(el.textContent)) return;
    if (inlineOnly(el)) { if (!st.done.has(el)) out.push({ el }); return; }
    for (const c of el.childNodes) {
      if (out.length >= st.max) return;
      if (c.nodeType === 3 && words(c.nodeValue) && !st.done.has(c)) out.push({ text: c });
      else if (c.nodeType === 1) visit(c, out);
    }
  }

  function markup(b) {
    if (b.text) { b.before = b.text.nodeValue; return escape(squash(b.text.nodeValue).trim()); }
    b.refs = [];
    b.saved = new Map(); // each element → its children before, for restore()
    const walk = (node) => {
      b.saved.set(node, [...node.childNodes]);
      let s = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) s += escape(squash(c.nodeValue));
        else if (c.nodeType === 1) {
          const k = b.refs.push(c) - 1;
          s += kept(c) ? `<g i=${k}></g>` : `<g i=${k}>${walk(c)}</g>`;
        }
      }
      return s;
    };
    return walk(b.el).trim();
  }

  // the block again, from the translation: its own elements where the tags are, the new text between them
  function rebuild(b, out) {
    if (b.text) {
      const v = b.text.nodeValue;
      b.text.nodeValue = v.match(/^\s*/)[0] + out + v.match(/\s*$/)[0];
      return true;
    }
    const parts = out.split(/(<g i=\d+>|<\/g>)/).filter(Boolean);
    const ids = parts.map((p) => /^<g i=(\d+)>$/.exec(p)?.[1]).filter((x) => x !== undefined).map(Number);
    // every element back exactly once, or the block stays as it was
    if (ids.length !== b.refs.length || new Set(ids).size !== ids.length || ids.some((i) => !b.refs[i])) return false;
    // plain text alone: just its words change (kindest to pages that redraw themselves, like React's)
    if (!b.refs.length && b.el.childNodes.length === 1 && b.el.firstChild.nodeType === 3) {
      b.plain = { node: b.el.firstChild, before: b.el.firstChild.nodeValue };
      b.plain.node.nodeValue = out;
      return true;
    }
    const frag = document.createDocumentFragment();
    const stack = [frag];
    for (const p of parts) {
      const open = /^<g i=(\d+)>$/.exec(p);
      if (open) {
        const el = b.refs[Number(open[1])];
        stack.at(-1)?.append(el);
        if (!kept(el)) el.replaceChildren();
        stack.push(kept(el) ? null : el);
      } else if (p === '</g>') { if (stack.length > 1) stack.pop(); } else stack.at(-1)?.append(p);
    }
    b.el.replaceChildren(frag);
    return true;
  }

  // text the page changes or adds after it was translated: its block is found again next time
  const watch = new MutationObserver((records) => {
    for (const r of records) {
      for (let n = r.target; n; n = n.parentNode) if (st.done.has(n)) { st.done.delete(n); break; }
    }
  });

  window.__ultimaTr = {
    // the next blocks to translate, as text with numbered tags
    collect(max = 300) {
      st.max = max;
      const found = [];
      if (document.body) visit(document.body, found);
      for (const b of found) { b.markup = markup(b); st.done.add(b.el || b.text); }
      st.pending = found.filter((b) => b.markup);
      return st.pending.map((b) => b.markup);
    },
    // their translations, in the same order
    apply(list) {
      st.pending.forEach((b, i) => {
        if (typeof list[i] !== 'string') return;
        try { if (rebuild(b, list[i])) st.blocks.push(b); } catch { /* left as it was */ }
      });
      st.pending = [];
      watch.takeRecords(); // (not the changes just made)
      if (!st.on && document.body) { st.on = true; watch.observe(document.body, { childList: true, characterData: true, subtree: true }); }
    },
    restore() {
      watch.disconnect();
      for (const b of st.blocks.reverse()) {
        if (b.text) b.text.nodeValue = b.before;
        else for (const [el, kids] of [...b.saved].reverse()) el.replaceChildren(...kids);
        if (b.plain) b.plain.node.nodeValue = b.plain.before;
      }
      delete window.__ultimaTr;
      return true;
    },
  };
  return true;
})();
