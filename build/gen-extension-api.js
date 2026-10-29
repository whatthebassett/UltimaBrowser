// Writes src/extension-api.json: every Chrome extension API (namespaces, functions, events, enums, constants) as
// Chrome itself defines it, from Google's generated `chrome-types`. extension-compat.js uses it to stand in for what
// Electron lacks, so an extension never fails just because an API is missing.
// Run again when Electron moves to a newer Chrome:
//   npm i --no-save chrome-types typescript@5 && node build/gen-extension-api.js
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const file = require.resolve('chrome-types/index.d.ts');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

// JSDoc tags such as @chrome-permission, read from a declaration's comment
function tags(node) {
  const out = {};
  for (const t of ts.getJSDocTags(node)) {
    const name = t.tagName.text;
    const text = (typeof t.comment === 'string' ? t.comment : (t.comment || []).map((c) => c.text).join('')).trim();
    (out[name] ||= []).push(text);
  }
  return out;
}

// Left out: APIs Chrome only offers on other platforms, on its dev channel, or to policy-installed extensions
function unavailable(t) {
  if (t['chrome-channel']?.includes('dev')) return true;
  if (t['chrome-install-location']?.includes('policy')) return true;
  const platforms = t['chrome-platform'];
  return Boolean(platforms && !platforms.some((p) => p === 'win' || p === 'mac'));
}

// What a call resolves to, from its promise-returning overload: a(rray), b(oolean), n(umber), s(tring), o(bject), v(oid)
function kindOf(type) {
  if (!type) return 'v';
  if (ts.isTypeReferenceNode(type) && type.typeName.getText() === 'Promise') return kindOf(type.typeArguments?.[0]);
  if (ts.isArrayTypeNode(type) || (ts.isTypeReferenceNode(type) && type.typeName.getText() === 'Array')) return 'a';
  if (ts.isUnionTypeNode(type)) {
    const kinds = type.types.map(kindOf).filter((k) => k !== 'v');
    return kinds[0] || 'v';
  }
  switch (type.kind) {
    case ts.SyntaxKind.VoidKeyword: case ts.SyntaxKind.UndefinedKeyword: case ts.SyntaxKind.AnyKeyword: case ts.SyntaxKind.UnknownKeyword: return 'v';
    case ts.SyntaxKind.BooleanKeyword: return 'b';
    case ts.SyntaxKind.NumberKeyword: return 'n';
    case ts.SyntaxKind.StringKeyword: return 's';
    case ts.SyntaxKind.LiteralType: return 'v'; // `null`
    default: return 'o';
  }
}

// Chrome turns each enum into an object of constants: "bookmarks-bar" → BOOKMARKS_BAR
const enumKey = (v) => { const k = String(v).toUpperCase().replace(/[^A-Z0-9]+/g, '_'); return /^[0-9]/.test(k) ? `_${k}` : k; };

const interfaces = new Map(); // "ns.Name" -> InterfaceDeclaration (for properties such as storage areas and settings)
const namespaces = {};

function members(body, ns, entry) {
  for (const st of body.statements) {
    const t = tags(st);
    if (unavailable(t)) continue;
    if (ts.isFunctionDeclaration(st) && st.name) {
      const name = st.name.text;
      const kind = kindOf(st.type);
      if (!(name in entry.fn) || kind !== 'v') entry.fn[name] = kind; // overloads: keep the one that says what it returns
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText();
        const type = d.type;
        if (/^on[A-Z]/.test(name)) { if (!entry.ev.includes(name)) entry.ev.push(name); continue; }
        if (type && ts.isLiteralTypeNode(type)) {
          const lit = type.literal;
          entry.const[name] = ts.isNumericLiteral(lit) ? Number(lit.text) : lit.kind === ts.SyntaxKind.PrefixUnaryExpression ? -Number(lit.operand.text) : ts.isStringLiteral(lit) ? lit.text : lit.kind === ts.SyntaxKind.TrueKeyword;
        } else if (type) {
          entry.ref[name] = { type, ns }; // an object property (storage.local, privacy.network), worked out at the end
        }
      }
    } else if (ts.isTypeAliasDeclaration(st) && ts.isUnionTypeNode(st.type) && st.type.types.every((u) => ts.isLiteralTypeNode(u) && ts.isStringLiteral(u.literal))) {
      entry.enum[st.name.text] = Object.fromEntries(st.type.types.map((u) => [enumKey(u.literal.text), u.literal.text]));
    } else if (ts.isInterfaceDeclaration(st) || ts.isClassDeclaration(st)) {
      if (st.name) interfaces.set(`${ns}.${st.name.text}`, st);
    } else if (ts.isModuleDeclaration(st)) {
      walk(st, ns);
    }
  }
}

// `namespace devtools.panels { … }` is a chain of declarations: follow it to its block
function walk(mod, parent) {
  const t = tags(mod);
  if (unavailable(t)) return;
  let ns = parent ? `${parent}.${mod.name.text}` : mod.name.text.replace(/^_debugger$/, 'debugger');
  while (mod.body && ts.isModuleDeclaration(mod.body)) { mod = mod.body; ns += `.${mod.name.text}`; }
  if (!mod.body || !ts.isModuleBlock(mod.body)) return;
  const entry = (namespaces[ns] ||= { fn: {}, ev: [], enum: {}, const: {}, ref: {} });
  if (t['chrome-permission']) entry.perm = t['chrome-permission'];
  if (t['chrome-manifest']) entry.manifest = t['chrome-manifest'];
  if (t['chrome-disallow-service-workers']) entry.pagesOnly = true;
  if (t['chrome-min-manifest']?.includes('MV3')) entry.mv3 = true;
  members(mod.body, ns, entry);
}

// The definitions are in `declare namespace browser { export namespace tabs { … } }`; `chrome` mostly re-exports
// them and adds a few of its own. `debugger` is spelled `_debugger` there, being a reserved word.
for (const st of source.statements) {
  if (ts.isModuleDeclaration(st) && (st.name.text === 'browser' || st.name.text === 'chrome') && st.body && ts.isModuleBlock(st.body)) {
    for (const inner of st.body.statements) if (ts.isModuleDeclaration(inner)) walk(inner, '');
  }
}

// The calls, events and object properties of a property's type: an interface (types.ChromeSetting), an inline
// object type (privacy.network), or both joined (storage.local is StorageArea & { … })
function shape(type, ns, depth = 0) {
  const out = { fn: {}, ev: [], props: {} };
  const add = (list) => {
    for (const m of list) {
      const name = m.name?.getText();
      if (!name || unavailable(tags(m))) continue;
      if (ts.isMethodSignature(m) || ts.isMethodDeclaration(m)) {
        if (!(name in out.fn) || kindOf(m.type) !== 'v') out.fn[name] = kindOf(m.type);
      } else if (/^on[A-Z]/.test(name)) {
        if (!out.ev.includes(name)) out.ev.push(name);
      } else if (m.type && depth < 2) {
        const s = shape(m.type, ns, depth + 1);
        if (s) out.props[name] = s;
      }
    }
  };
  if (ts.isIntersectionTypeNode(type)) {
    for (const part of type.types) {
      const s = shape(part, ns, depth);
      if (s) { Object.assign(out.fn, s.fn); out.ev.push(...s.ev.filter((x) => !out.ev.includes(x))); Object.assign(out.props, s.props); }
    }
  } else if (ts.isTypeLiteralNode(type)) {
    add(type.members);
  } else if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText().replace(/^(browser|chrome)\./, '');
    const decl = interfaces.get(name.includes('.') ? name : `${ns}.${name}`);
    if (!decl) return null;
    add(decl.members);
  } else {
    return null;
  }
  if (!Object.keys(out.fn).length && !out.ev.length && !Object.keys(out.props).length) return null;
  const compact = {};
  if (Object.keys(out.fn).length) compact.fn = out.fn;
  if (out.ev.length) compact.ev = out.ev;
  if (Object.keys(out.props).length) compact.props = out.props;
  return compact;
}

// compact: leave out empty parts
const result = {};
for (const [ns, e] of Object.entries(namespaces)) {
  const props = {};
  for (const [name, ref] of Object.entries(e.ref)) { const s = shape(ref.type, ref.ns); if (s) props[name] = s; }
  const out = {};
  for (const k of ['perm', 'manifest', 'pagesOnly', 'mv3']) if (e[k]) out[k] = e[k];
  if (Object.keys(e.fn).length) out.fn = e.fn;
  if (e.ev.length) out.ev = e.ev;
  if (Object.keys(e.enum).length) out.enum = e.enum;
  if (Object.keys(e.const).length) out.const = e.const;
  if (Object.keys(props).length) out.props = props;
  result[ns] = out;
}

const version = require('chrome-types/package.json').version;
const target = path.join(__dirname, '..', 'src', 'extension-api.json');
fs.writeFileSync(target, `${JSON.stringify({ source: `chrome-types ${version}`, namespaces: result })}\n`);
console.log(`Wrote ${Object.keys(result).length} namespaces to ${path.relative(process.cwd(), target)}`);
