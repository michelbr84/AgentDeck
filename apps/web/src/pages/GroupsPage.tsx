/**
 * Groups — build rooms of agents and see exactly how a message gets routed.
 *
 * The delivery trace is the part worth having: the orchestrator already records
 * *why* a message reached (or did not reach) each agent, and surfacing that
 * turns "nobody answered" from a mystery into a readable reason.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';
import { apiFetch } from '../api';

type RoomMode = 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';

interface Room {
  id: string;
  name: string;
  description?: string;
  mode: RoomMode;
  defaultAgentInstanceId?: string | null;
  maxTurnsPerRun?: number;
  maxRuntimeSec?: number;
  maxCostUSD?: number;
  turnTimeoutSec?: number;
}

interface AgentInstance {
  id: string;
  name: string;
  isActive?: boolean;
  persona: { avatarEmoji?: string; role: string };
}

interface RoomMember {
  id: string;
  memberType: 'agent_instance' | 'user';
  memberId: string;
  role: string;
}

const MODE_HELP: Record<RoomMode, string> = {
  mention: 'Only the @mentioned agent answers. Falls back to the room default agent.',
  panel: 'Every member answers the same message, independently.',
  debate: 'Structured roles: proposer opens, members critique, the lead synthesizes.',
  round_robin: 'One agent per turn, cycling through the members in order.',
  coordinator: 'A lead agent delegates to the others and synthesises the result.',
};

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

export function GroupsPage({ notify }: { notify: Notify }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [membersByRoom, setMembersByRoom] = useState<Record<string, RoomMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<RoomMode>('mention');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roomList, instanceList] = await Promise.all([
        apiFetch<Room[]>('/api/v1/rooms'),
        apiFetch<AgentInstance[]>('/api/v1/instances'),
      ]);
      setRooms(roomList);
      setInstances(instanceList);

      const entries = await Promise.all(
        roomList.map(async (r) => {
          const members = await apiFetch<RoomMember[]>(`/api/v1/rooms/${r.id}/members`);
          return [r.id, members] as const;
        })
      );
      setMembersByRoom(Object.fromEntries(entries));
    } catch (err) {
      notify('error', `Could not load groups: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const createRoom = async () => {
    if (!newName.trim()) return;
    setBusy('create');
    try {
      await apiFetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), mode: newMode }),
      });
      setNewName('');
      notify('success', `Group "${newName.trim()}" created.`);
      await load();
    } catch (err) {
      notify('error', `Could not create the group: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleMember = async (roomId: string, instanceId: string, isMember: boolean) => {
    setBusy(`${roomId}-${instanceId}`);
    try {
      if (isMember) {
        await apiFetch(`/api/v1/rooms/${roomId}/members/${instanceId}`, { method: 'DELETE' });
      } else {
        await apiFetch(`/api/v1/rooms/${roomId}/members`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ memberType: 'agent_instance', memberId: instanceId, role: 'participant' }),
        });
      }
      await load();
    } catch (err) {
      notify('error', `Could not update membership: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const setMode = async (room: Room, mode: RoomMode) => {
    setBusy(`mode-${room.id}`);
    try {
      await apiFetch(`/api/v1/rooms/${room.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...room, mode }),
      });
      await load();
    } catch (err) {
      notify('error', `Could not change the mode: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const setDefaultAgent = async (roomId: string, instanceId: string | null) => {
    setBusy(`default-${roomId}`);
    try {
      await apiFetch(`/api/v1/rooms/${roomId}/default-agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The server reads `defaultAgentInstanceId` (see POST /api/v1/rooms/:id/default-agent).
        body: JSON.stringify({ defaultAgentInstanceId: instanceId }),
      });
      await load();
    } catch (err) {
      notify('error', `Could not set the default agent: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const deleteRoom = async (room: Room) => {
    if (!window.confirm(`Delete group "${room.name}"? Its messages and history are removed permanently.`)) {
      return;
    }
    setBusy(`delete-${room.id}`);
    try {
      await apiFetch(`/api/v1/rooms/${room.id}`, { method: 'DELETE' });
      notify('success', `Group "${room.name}" deleted.`);
      await load();
    } catch (err) {
      notify('error', `Could not delete the group: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const saveLimits = async (
    room: Room,
    limits: { maxTurnsPerRun?: number; maxRuntimeSec?: number; turnTimeoutSec?: number }
  ) => {
    setBusy(`limits-${room.id}`);
    try {
      await apiFetch(`/api/v1/rooms/${room.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(limits),
      });
      notify('success', `Limits updated for "${room.name}".`);
      await load();
    } catch (err) {
      notify('error', `Could not update limits: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-garra-muted p-8" data-testid="groups-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading groups…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-groups">
      <section className="glass-panel p-6" data-testid="create-group-card">
        <h2 className="text-lg font-extrabold flex items-center gap-2 mb-1">
          <Users className="w-5 h-5 text-garra-primary" /> Groups
        </h2>
        <p className="text-sm text-garra-muted mb-5">
          A group puts several agents in one conversation. The mode decides who answers.
        </p>

        <div className="flex flex-wrap gap-2.5 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-garra-muted mb-1.5">Name</label>
            <input
              className="field"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Architecture review"
              data-testid="new-group-name"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs font-bold text-garra-muted mb-1.5">Mode</label>
            <select
              className="field"
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as RoomMode)}
              data-testid="new-group-mode"
            >
              {(Object.keys(MODE_HELP) as RoomMode[]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn-gold"
            onClick={() => void createRoom()}
            disabled={busy !== null || !newName.trim()}
            data-testid="new-group-create"
          >
            <Plus className="w-3.5 h-3.5 inline mr-1" /> Create
          </button>
        </div>
        <p className="text-xs text-garra-muted-2 mt-2">{MODE_HELP[newMode]}</p>
      </section>

      {rooms.length === 0 && (
        <p className="text-garra-muted text-sm px-1" data-testid="groups-empty">
          No groups yet. Create one above, then add agents to it.
        </p>
      )}

      {rooms.map((room) => {
        const members = membersByRoom[room.id] ?? [];
        const memberIds = new Set(
          members.filter((m) => m.memberType === 'agent_instance').map((m) => m.memberId)
        );
        return (
          <section key={room.id} className="glass-panel p-5" data-testid={`group-${room.id}`}>
            <header className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h3 className="font-extrabold">{room.name}</h3>
                <p className="text-xs text-garra-muted mt-0.5">{MODE_HELP[room.mode]}</p>
              </div>
              <div className="flex gap-2 items-center">
                <select
                  className="field !w-auto"
                  value={room.mode}
                  onChange={(e) => void setMode(room, e.target.value as RoomMode)}
                  disabled={busy !== null}
                  data-testid={`group-${room.id}-mode`}
                >
                  {(Object.keys(MODE_HELP) as RoomMode[]).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <button
                  className="p-2 rounded-garraSm border border-garra-border text-red-400 hover:bg-red-950/40 transition"
                  title="Delete group"
                  onClick={() => void deleteRoom(room)}
                  disabled={busy !== null}
                  data-testid={`group-${room.id}-delete`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </header>

            <div className="grid gap-2 sm:grid-cols-2" data-testid={`group-${room.id}-members`}>
              {instances.map((inst) => {
                const isMember = memberIds.has(inst.id);
                return (
                  <label
                    key={inst.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-garraSm border cursor-pointer transition ${
                      isMember
                        ? 'border-garra-borderStrong bg-garra-panel2'
                        : 'border-garra-border hover:bg-garra-panel'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isMember}
                      disabled={busy !== null}
                      onChange={() => void toggleMember(room.id, inst.id, isMember)}
                      data-testid={`group-${room.id}-member-${inst.id}`}
                    />
                    <span>{inst.persona.avatarEmoji || '🤖'}</span>
                    <span className="text-sm font-semibold">{inst.name}</span>
                    <span className="text-xs text-garra-muted ml-auto">{inst.persona.role}</span>
                  </label>
                );
              })}
            </div>

            {room.mode === 'mention' && (
              <div className="mt-4">
                <label className="block text-xs font-bold text-garra-muted mb-1.5">
                  Default agent — answers untagged messages
                </label>
                <select
                  className="field"
                  value={room.defaultAgentInstanceId ?? ''}
                  onChange={(e) => void setDefaultAgent(room.id, e.target.value || null)}
                  disabled={busy !== null}
                  data-testid={`group-${room.id}-default-agent`}
                >
                  <option value="">None — an explicit @mention is required</option>
                  {instances
                    .filter((i) => memberIds.has(i.id))
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.persona.avatarEmoji || '🤖'} {i.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <form
              className="mt-4 flex flex-wrap items-end gap-2 text-xs"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                const num = (key: string) => {
                  const v = Number(data.get(key));
                  return Number.isFinite(v) && v > 0 ? v : undefined;
                };
                void saveLimits(room, {
                  maxTurnsPerRun: num('maxTurnsPerRun'),
                  maxRuntimeSec: num('maxRuntimeSec'),
                  turnTimeoutSec: num('turnTimeoutSec'),
                });
              }}
              data-testid={`group-${room.id}-limits`}
            >
              <label className="flex flex-col gap-1 text-garra-muted">
                Turns per run
                <input className="field !w-24" type="number" min={1} name="maxTurnsPerRun" defaultValue={room.maxTurnsPerRun ?? 10} />
              </label>
              <label className="flex flex-col gap-1 text-garra-muted">
                Runtime cap (s)
                <input className="field !w-24" type="number" min={1} name="maxRuntimeSec" defaultValue={room.maxRuntimeSec ?? 600} />
              </label>
              <label className="flex flex-col gap-1 text-garra-muted">
                Turn timeout (s)
                <input className="field !w-24" type="number" min={1} name="turnTimeoutSec" defaultValue={room.turnTimeoutSec ?? ''} placeholder="120" />
              </label>
              <button className="btn-gold !py-2" type="submit" disabled={busy !== null}>
                Save limits
              </button>
              <span className="text-garra-muted-2 ml-2">
                Inter-agent calls are limited separately (depth 3, 12 turns, 30 calls/min).
              </span>
            </form>
          </section>
        );
      })}
    </div>
  );
}