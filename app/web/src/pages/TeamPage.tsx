import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAgents, useAgent, useCreateAgent, useMessageAgent, useDeleteAgent } from '@/lib/api';
import { Avatar, Dot, Empty } from '@/components/sb';
import { cn } from '@/lib/utils';

const CARD = 'rounded-lg border border-line bg-surface p-[18px]';
const LABEL = 'font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-dim';
const inputCls = 'h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-[13px] text-fg placeholder:text-dim-2 focus:border-brand/60 focus:outline-none';
const TOOLS = ['github', 'slack', 'web', 'team'];
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

function NewAgent() {
  const create = useCreateAgent();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [role, setRole] = useState('');
  const [connectors, setConnectors] = useState<string[]>([]);
  const [memory, setMemory] = useState(false);
  const toggle = (c: string) => setConnectors((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c]));
  const submit = () => create.mutate({ name: slugify(name), summary, role, connectors, memory }, { onSuccess: (a) => navigate(`/team/${a.name}`) });
  if (!open) return <button onClick={() => setOpen(true)} className="flex h-9 items-center gap-2 rounded-md bg-brand px-[15px] font-display text-[12.5px] font-semibold text-[#16130f] hover:bg-brand-deep"><span className="-mt-px text-[16px] leading-none">+</span>New agent</button>;
  return (
    <div className={cn(CARD, 'mb-5')}>
      <div className={`${LABEL} mb-3`}>New agent</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div><div className="mb-1 text-[11px] text-dim-2">Name</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="reviewer" className={cn(inputCls, 'font-mono')} /></div>
        <div><div className="mb-1 text-[11px] text-dim-2">One-line summary</div><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="reviews diffs and flags risk" className={inputCls} /></div>
      </div>
      <div className="mt-3"><div className="mb-1 text-[11px] text-dim-2">Role · standing instructions</div>
        <textarea value={role} onChange={(e) => setRole(e.target.value)} rows={3} placeholder="You are a careful code reviewer. When asked, review the change and report concrete risks and suggestions." className={cn(inputCls, 'h-auto resize-y py-2 leading-snug')} />
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex flex-wrap gap-1.5">
          {TOOLS.map((c) => <button key={c} onClick={() => toggle(c)} className={cn('rounded-[5px] border px-2.5 py-1 font-mono text-[11px] font-medium', connectors.includes(c) ? 'border-brand/50 bg-brand/12 text-brand-soft' : 'border-line bg-surface text-muted hover:text-t2')}>{c}</button>)}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-t2"><input type="checkbox" checked={memory} onChange={(e) => setMemory(e.target.checked)} className="h-4 w-4 accent-[#5b9ee6]" />memory</label>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setOpen(false)} className="h-9 rounded-md border border-line bg-surface-2 px-3.5 font-display text-[12.5px] font-semibold text-t2 hover:border-hair">Cancel</button>
          <button onClick={submit} disabled={!name.trim() || create.isPending} className="h-9 rounded-md bg-brand px-3.5 font-display text-[12.5px] font-semibold text-[#16130f] hover:bg-brand-deep disabled:opacity-40">{create.isPending ? 'Creating…' : 'Create agent'}</button>
        </div>
      </div>
      {create.isError && <div className="mt-2 text-[12px] text-bad">{(create.error as Error).message}</div>}
    </div>
  );
}

export function TeamPage() {
  const { data: agents } = useAgents();
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6 font-sans text-fg animate-fade-up">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="mb-[5px] font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">Switchboard</div>
          <div className="font-display text-[26px] font-bold tracking-tight">Team</div>
          <div className="mt-[3px] text-[13px] text-muted-2">Named agents you and your routines can hand tasks to. Grant the <span className="font-mono text-[#ada695]">team</span> tool to a routine so it can delegate.</div>
        </div>
        <NewAgent />
      </div>
      {!agents ? <div className="py-10 text-center font-mono text-[12px] text-dim">Loading…</div>
        : agents.length === 0 ? <Empty title="No agents yet" hint="Create one — it gets a role, tools, and a task log routines can delegate to." />
          : (
            <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' }}>
              {agents.map((a) => (
                <Link key={a.name} to={`/team/${a.name}`} className={cn(CARD, 'block transition-colors hover:border-hair')}>
                  <div className="flex items-center gap-3">
                    <Avatar color={a.avColor} initials={a.name[0].toUpperCase()} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15px] font-semibold text-fg-2">{a.name}</div>
                      <div className="truncate font-sans text-[12px] text-muted-2">{a.summary || a.role || 'agent'}</div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium" style={{ color: a.status === 'working' ? '#5b9ee6' : '#7f8a80' }}>
                      <Dot color={a.status === 'working' ? '#5b9ee6' : '#5d594f'} size={7} pulse={a.status === 'working'} />{a.status}
                    </span>
                  </div>
                  {a.currentTask && <div className="mt-3 truncate rounded-md border border-line-soft bg-code px-2.5 py-1.5 font-mono text-[11px] text-muted">tackling: {a.currentTask}</div>}
                  <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-dim">
                    <span>{a.taskCount} task{a.taskCount === 1 ? '' : 's'}</span>
                    <span className="text-hair">·</span><span>last {a.lastActive}</span>
                    {a.connectors.length > 0 && <><span className="text-hair">·</span><span className="text-[#ada695]">{a.connectors.join(' ')}</span></>}
                    {a.memory && <span className="text-lease">memory</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
    </div>
  );
}

export function AgentPage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const { data: a } = useAgent(name);
  const message = useMessageAgent();
  const del = useDeleteAgent();
  const [text, setText] = useState('');
  if (!a) return <div className="px-6 py-10 text-muted">Loading…</div>;
  const send = () => { if (!text.trim()) return; message.mutate({ name: a.name, text: text.trim() }, { onSuccess: (r) => navigate(`/runs/${r.runId}`) }); };
  return (
    <div className="font-sans text-fg animate-fade-up">
      <div className="border-b border-line-soft bg-head px-[26px] py-[22px]">
        <div className="mb-3 font-mono text-[12px] font-medium text-dim"><span className="text-brand">Switchboard</span> › <Link to="/team" className="text-brand">Team</Link> › {a.name}</div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <Avatar color={a.avColor} initials={a.name[0].toUpperCase()} size={30} />
            <span className="font-display text-[23px] font-bold tracking-tight">{a.name}</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] font-medium" style={{ color: a.status === 'working' ? '#5b9ee6' : '#7f8a80' }}><Dot color={a.status === 'working' ? '#5b9ee6' : '#5d594f'} size={8} pulse={a.status === 'working'} />{a.status}</span>
          </div>
          <button onClick={() => { if (confirm(`Delete agent “${a.name}” and its task log?`)) del.mutate(a.name, { onSuccess: () => navigate('/team') }); }} className="flex h-[34px] items-center rounded-md border border-bad/40 px-[13px] font-display text-[12.5px] font-semibold text-bad hover:bg-bad/10">Delete</button>
        </div>
        <div className="mt-[11px] flex flex-wrap items-center gap-2.5 font-mono text-[12px] text-muted-2">
          <span>{a.summary || a.role || 'agent'}</span>
          {a.connectors.map((c) => <span key={c} className="rounded-[5px] border border-white/[0.08] bg-white/[0.045] px-1.5 py-px text-[11px] text-[#ada695]">{c}</span>)}
          <span className="text-hair">|</span><span>{a.model}</span>{a.memory && <span className="text-lease">memory</span>}
        </div>
      </div>

      <div className="grid gap-[22px] px-[26px] py-[22px]" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <div className="flex flex-col gap-[18px]">
          <div className={CARD}>
            <div className={`${LABEL} mb-3`}>Ask {a.name} to do something</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} rows={3} placeholder={`e.g. "Review PR #42 in acme/web and post the risks to #dev-ai-slop"`} className={cn(inputCls, 'h-auto resize-y py-2.5 leading-snug')} />
            <div className="mt-2.5 flex items-center justify-between">
              <span className="font-mono text-[11px] text-dim">⌘↵ to send · the task runs as a session you can watch live</span>
              <button onClick={send} disabled={!text.trim() || message.isPending} className="h-9 rounded-md bg-brand px-4 font-display text-[12.5px] font-semibold text-[#16130f] hover:bg-brand-deep disabled:opacity-40">{message.isPending ? 'Sending…' : 'Send task'}</button>
            </div>
          </div>
          {a.role && (
            <div className={CARD}>
              <div className={`${LABEL} mb-3`}>Role</div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-[1.6] text-muted">{a.role}</pre>
            </div>
          )}
        </div>

        <div className={CARD}>
          <div className={`${LABEL} mb-3.5`}>Task log · what it was asked & did</div>
          {a.tasks.length === 0 ? <div className="py-2 font-mono text-[12px] text-dim">No tasks yet — send one above.</div> : (
            <div className="flex flex-col gap-3">
              {a.tasks.map((t) => (
                <Link key={t.id} to={`/runs/${t.id}`} className="block border-b border-line-soft pb-3 last:border-0 hover:opacity-80">
                  <div className="flex items-center gap-2">
                    <Dot state={t.status} size={7} />
                    <span className="flex-1 truncate font-sans text-[12.5px] font-medium text-t2">{t.task}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">{t.ago}</span>
                  </div>
                  <div className="mt-1 pl-[15px] font-mono text-[11px] leading-snug text-dim">{t.status === 'running' ? 'working…' : t.result || '—'}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
