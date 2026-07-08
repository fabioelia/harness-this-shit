#!/usr/bin/env node
// Stand-in for the `claude` binary in tests: consumes the stdin prompt and emits
// a plausible stream-json session. FAKE_FAIL=1 → error result; FAKE_HANG=1 → never exits.
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_HANG === '1') { setInterval(() => {}, 60_000); return; } // really hang — let the harness timeout reap us
  const emit = (o) => console.log(JSON.stringify(o));
  emit({ type: 'system', subtype: 'init', model: 'fake-model', tools: ['Bash'], permissionMode: 'bypassPermissions', cwd: process.cwd() });
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo hi' } }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'hi' }] } });
  if (process.env.FAKE_FAIL === '1') {
    emit({ type: 'result', result: 'it broke', is_error: true, total_cost_usd: 0.001, num_turns: 1, session_id: 'sess_fake' });
  } else {
    const secret = process.env.TEST_SECRET_VALUE ?? '';
    emit({ type: 'result', result: `did the thing (prompt ${input.length} chars)${secret ? ` token=${secret}` : ''}\nhttps://github.com/acme/x/pull/7`, is_error: false, total_cost_usd: 0.0123, num_turns: 2, session_id: 'sess_fake', usage: { input_tokens: 100, output_tokens: 20 } });
  }
});
