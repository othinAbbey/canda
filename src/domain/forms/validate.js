import { ValidationError } from "../../errors.js";

/**
 * Check a form's data against its template, and build the summary shown in lists. Pure functions, no database.
 * Drafts may be incomplete (only types are checked). Moving past draft also enforces what the template marks as required.
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESULTS = ["pass", "fail", "na"], YESNO = ["yes", "no", "na"];
const MAX_ROWS = 200, MAX_TEXT = 5000;

const empty = (v) => v === undefined || v === null || v === "";

/** Returns the cleaned value, or throws a string message. */
function coerce(def, raw) {
  if (empty(raw)) return undefined;
  switch (def.type) {
    case "number": { const n = Number(raw); if (!Number.isFinite(n)) throw "must be a number"; return n; }
    case "date": if (!DATE.test(String(raw))) throw "must be a date (YYYY-MM-DD)"; return String(raw);
    case "time": if (!TIME.test(String(raw))) throw "must be a time (HH:MM)"; return String(raw);
    case "select": if (!def.options.includes(String(raw))) throw `must be one of: ${def.options.join(", ")}`; return String(raw);
    case "yesno": if (!YESNO.includes(String(raw))) throw "must be yes, no or na"; return String(raw);
    default: { const s = String(raw).trim(); if (s.length > MAX_TEXT) throw "is too long"; return s || undefined; }
  }
}

export function cleanData(template, data = {}) {
  const out = {}, errors = [];
  const bad = (where, label, msg) => errors.push(`${where}${label}: ${msg}`);
  for (const s of template.sections) {
    const raw = data[s.id];
    if (s.type === "checklist") {
      const rows = {};
      for (const item of s.items) {
        const a = raw && typeof raw === "object" ? raw[item.id] : null;
        if (!a || (empty(a.result) && empty(a.note))) continue;
        if (!empty(a.result) && !RESULTS.includes(a.result)) { bad(`${s.title}: `, item.label, "result must be pass, fail or na"); continue; }
        rows[item.id] = { ...(a.result ? { result: a.result } : {}), ...(!empty(a.note) ? { note: String(a.note).trim().slice(0, 500) } : {}) };
      }
      if (Object.keys(rows).length) out[s.id] = rows;
    } else if (s.type === "table") {
      const list = Array.isArray(raw) ? raw : [];
      if (list.length > MAX_ROWS) errors.push(`${s.title}: too many rows (limit ${MAX_ROWS})`);
      const rows = [];
      list.slice(0, MAX_ROWS).forEach((r, i) => {
        const row = {};
        for (const c of s.columns) { try { const v = coerce(c, r?.[c.id]); if (v !== undefined) row[c.id] = v; } catch (m) { bad(`${s.title}, row ${i + 1}: `, c.label, m); } }
        if (Object.keys(row).length) rows.push(row);
      });
      if (rows.length) out[s.id] = rows;
    } else {
      const sec = {};
      for (const f of s.fields) { try { const v = coerce(f, raw?.[f.id]); if (v !== undefined) sec[f.id] = v; } catch (m) { bad(`${s.title}: `, f.label, m); } }
      if (Object.keys(sec).length) out[s.id] = sec;
    }
  }
  return { data: out, errors };
}

/** Rules for a record that is no longer a draft. Returns a list of plain-language problems. */
export function missingFor(template, data, status) {
  const at = template.statuses.indexOf(status);
  if (at < 1) return [];
  const needed = (x, dflt) => (x.requiredAt ? at >= template.statuses.indexOf(x.requiredAt) : dflt && at >= 1);
  const problems = [];
  for (const s of template.sections) {
    if (s.type === "checklist") {
      if (!needed(s, true)) continue;
      const a = data[s.id] || {};
      const open = s.items.filter((i) => !a[i.id]?.result), noNote = s.items.filter((i) => a[i.id]?.result === "fail" && !a[i.id]?.note);
      if (open.length) problems.push(`${s.title}: ${open.length} item${open.length > 1 ? "s are" : " is"} not answered`);
      if (noNote.length) problems.push(`${s.title}: explain each failed item (${noNote.length} without a note)`);
    } else if (s.type === "table") {
      const rows = data[s.id] || [];
      if (s.minRows && needed(s, true) && rows.length < s.minRows) problems.push(`${s.title}: add at least ${s.minRows} row${s.minRows > 1 ? "s" : ""}`);
      rows.forEach((r, i) => { for (const c of s.columns) if (c.required && empty(r[c.id])) problems.push(`${s.title}, row ${i + 1}: ${c.label} is required`); });
    } else {
      for (const f of s.fields) if (needed(f, f.required) && empty(data[s.id]?.[f.id])) problems.push(`${f.label} is required`);
    }
  }
  return problems;
}

/** Cleans, then (for non-drafts) enforces required items. Throws ValidationError with every problem found. */
export function validateRecord(template, data, status) {
  if (!template.statuses.includes(status)) throw new ValidationError(`status must be one of: ${template.statuses.join(", ")}`);
  if (data !== undefined && (data === null || typeof data !== "object" || Array.isArray(data))) throw new ValidationError("data must be an object");
  const { data: clean, errors } = cleanData(template, data || {});
  const problems = [...errors, ...missingFor(template, clean, status)];
  if (problems.length) {
    const shown = problems.slice(0, 6).join("; ");
    throw new ValidationError(`${status === template.statuses[0] ? "Please fix" : `Cannot mark as "${status}"`}: ${shown}${problems.length > 6 ? ` (and ${problems.length - 6} more)` : ""}`);
  }
  if (JSON.stringify(clean).length > 200_000) throw new ValidationError("this form is too large");
  return clean;
}

/** Counts for list views: checklist answers and open rows in tracked tables. */
export function summarize(template, data) {
  const checks = { pass: 0, fail: 0, na: 0, total: 0 };
  let open = null;
  for (const s of template.sections) {
    if (s.type === "checklist") {
      for (const i of s.items) { checks.total++; const r = data[s.id]?.[i.id]?.result; if (r) checks[r]++; }
    } else if (s.type === "table" && s.track) {
      open = (open || 0) + (data[s.id] || []).filter((r) => !s.track.closed.includes(r[s.track.column])).length;
    }
  }
  return { checks: checks.total ? { ...checks, answered: checks.pass + checks.fail + checks.na } : null, open };
}

/** Sanity check of a template definition itself (used by tests, so a typo cannot ship). */
export function templateProblems(t) {
  const out = [], seen = new Set(), types = ["text", "longtext", "number", "date", "time", "select", "yesno"];
  const first = (id, where) => { if (seen.has(`${where}`)) out.push(`duplicate id ${where}`); seen.add(where); if (!/^[a-z][a-z0-9_]*$/.test(id)) out.push(`bad id ${where}`); };
  if (!t.statuses?.length || t.statuses[0] !== "draft") out.push("first status must be draft");
  for (const s of t.sections) {
    first(s.id, `${t.code}.${s.id}`);
    const defs = s.type === "table" ? s.columns : s.type === "checklist" ? [] : s.fields;
    if (s.type === "checklist") { const ids = new Set(); for (const i of s.items) { if (ids.has(i.id)) out.push(`duplicate item ${i.id}`); ids.add(i.id); if (!i.label) out.push(`item ${i.id} has no label`); } }
    const ids = new Set();
    for (const f of defs) {
      if (ids.has(f.id)) out.push(`duplicate field ${s.id}.${f.id}`); ids.add(f.id);
      if (!types.includes(f.type)) out.push(`unknown type ${f.type} at ${s.id}.${f.id}`);
      if (f.type === "select" && !f.options?.length) out.push(`select without options at ${s.id}.${f.id}`);
      if (f.requiredAt && !t.statuses.includes(f.requiredAt)) out.push(`requiredAt ${f.requiredAt} is not a status at ${s.id}.${f.id}`);
    }
    if (s.requiredAt && !t.statuses.includes(s.requiredAt)) out.push(`requiredAt ${s.requiredAt} is not a status at ${s.id}`);
    if (s.track && !s.columns.some((c) => c.id === s.track.column)) out.push(`track column missing in ${s.id}`);
  }
  return out;
}
