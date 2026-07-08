// Split a routine .md into { meta, body, prompt, handlers } per docs/02 §3:
// the body's `## Prompt` section is the operative prompt (whole body if absent),
// and each `## handler: <name>` section is a self-contained reaction sub-prompt.
import YAML from 'yaml';

export function splitFrontMatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: null, body: String(text) };
  let meta;
  try {
    meta = YAML.parse(m[1]);
  } catch (e) {
    throw new Error(`front matter YAML: ${e.message.split('\n')[0]}`);
  }
  if (meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) {
    throw new Error('front matter must be a YAML mapping');
  }
  return { meta: meta ?? {}, body: m[2] ?? '' };
}

// Carve the body into H2 sections. Returns ordered [{ heading, text }] where
// heading '' is anything before the first `## `.
function sections(body) {
  const out = [];
  let heading = '', buf = [];
  for (const line of String(body).split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { out.push({ heading, text: buf.join('\n') }); heading = h[1]; buf = []; }
    else buf.push(line);
  }
  out.push({ heading, text: buf.join('\n') });
  return out;
}

export function parseBody(body) {
  const secs = sections(body);
  const handlers = {};
  for (const s of secs) {
    const h = s.heading.match(/^handler:\s*(.+)$/i);
    if (h) handlers[h[1].trim()] = s.text.trim();
  }
  // Per docs/02 §3: text ABOVE `## Prompt` is human-facing context; the operative
  // prompt is the Prompt section plus everything after it (## Constraints, numbered
  // procedure sections, …) except `## handler:` sections. No ## Prompt → whole body.
  const promptIdx = secs.findIndex((s) => /^prompt$/i.test(s.heading));
  const operative = (promptIdx >= 0 ? secs.slice(promptIdx) : secs).filter((s) => !/^handler:/i.test(s.heading));
  const prompt = operative
    .map((s, i) => (s.heading && !(i === 0 && promptIdx >= 0) ? `## ${s.heading}\n${s.text}` : s.text))
    .join('\n').trim();
  return { prompt, handlers };
}

export function parseRoutineFile(text) {
  const { meta, body } = splitFrontMatter(text);
  const { prompt, handlers } = parseBody(body);
  return { meta, body: body.trim(), prompt, handlers };
}
