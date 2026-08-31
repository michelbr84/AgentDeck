import React, { useState, useEffect, useRef } from 'react';
import { useEventStream, StreamEnvelope } from './hooks/useEventStream';
import {
  Bot,
  MessageSquare,
  Shield,
  Terminal,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Radio,
  Plus,
  Edit2,
  Copy,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Settings,
  X,
  Info,
  Check,
  Zap,
  Users,
  KeyRound,
} from 'lucide-react';
import { WEB_APP_VERSION } from './version';
import { apiFetch, tokenStore } from './api';
import { AUTH_REQUIRED_EVENT } from './auth';
import { useFocusTrap } from './hooks/useFocusTrap';
import { AgentControlPage } from './pages/AgentControlPage';
import { GroupsPage } from './pages/GroupsPage';

interface PromptLayer {
  id: string;
  order: number;
  layerName: string;
  source: string;
  content: string;
}

interface InspectedPromptData {
  totalEstimatedTokens?: {
    value: number;
  };
  layers?: PromptLayer[];
}

interface AgentInstallation {
  id: string;
  definitionId: string;
  binaryPath: string | null;
  versionInstalled: string | null;
  versionLatest: string | null;
  state: {
    availability: string;
    installation: string;
    health: string;
    version: string;
  };
}

interface Persona {
  id: string;
  name: string;
  role: string;
  language: string;
  systemPromptOverlay: string;
  avatarEmoji: string;
  responseStyle?: string;
  isTemplate?: boolean;
}

interface AgentInstance {
  id: string;
  name: string;
  personaId: string;
  installationId: string;
  modelAlias?: string;
  workspaceDir?: string;
  permissionTier: string;
  isActive: boolean;
  persona: Persona;
  installation: {
    id: string;
    definitionId: string;
  };
}

interface RoomMember {
  id: string;
  roomId: string;
  memberType: 'agent_instance' | 'user';
  memberId: string;
  role: string;
}

interface Room {
  id: string;
  name: string;
  mode: 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';
  description: string;
  defaultAgentInstanceId?: string | null;
  turnLimit?: number;
  workspacePath?: string;
}

interface ChatDeliveryTrace {
  state: 'persisted' | 'routing' | 'running' | 'completed' | 'failed' | 'no_target';
  reasonCode: string;
  feedbackMessage: string;
  actionableHint?: string;
  targetInstanceIds: string[];
  targetInstanceNames: string[];
  roomMode: string;
  timestamp: string;
}

interface Message {
  id: string;
  roomId?: string;
  senderId?: string;
  senderDisplayName: string;
  senderType: string;
  content: string;
  contentType?: string;
  deliveryTrace?: ChatDeliveryTrace;
  createdAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'control' | 'groups' | 'agents' | 'personas' | 'chat' | 'prompt'>('control');
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; displayName: string; avatar?: string }>>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem('agentdeck-user-id');
    } catch {
      return null;
    }
  });
  const [isSending, setIsSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [streamingTurns, setStreamingTurns] = useState<Record<string, { instanceName: string; text: string }>>({});
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [inspectedPrompt, setInspectedPrompt] = useState<InspectedPromptData | null>(null);
  const [statusNotification, setStatusNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Modals & Forms
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [personaForm, setPersonaForm] = useState({
    name: '',
    role: '',
    language: 'pt-BR',
    avatarEmoji: '🤖',
    systemPromptOverlay: '',
    responseStyle: '',
  });

  const [showInstanceModal, setShowInstanceModal] = useState(false);
  const [editingInstance, setEditingInstance] = useState<AgentInstance | null>(null);
  const [instanceForm, setInstanceForm] = useState({
    name: '',
    installationId: '',
    personaId: '',
    modelAlias: '',
    permissionTier: 'developer',
    isActive: true,
  });

  const [showRoomSettingsModal, setShowRoomSettingsModal] = useState(false);

  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createRoomForm, setCreateRoomForm] = useState<{
    name: string;
    description: string;
    mode: Room['mode'];
    memberInstanceIds: string[];
  }>({
    name: '',
    description: '',
    mode: 'mention',
    memberInstanceIds: [],
  });

  // `agentdeck web --token`: prompt for the secret when the daemon answers 401.
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);
  // Keyboard focus stays inside the auth dialog while it is up; the page
  // behind it cannot be used anyway.
  const authDialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(authDialogRef, showAuthModal);

  useEffect(() => {
    // The one-shot ?token= / #token= sign-in is applied when api.ts is
    // evaluated (see adoptTokenFromLocation), i.e. before this or any child
    // page effect can issue a request. Here we only react to 401s.
    const onAuthRequired = (event: Event) => {
      // Only a 401 for the token we currently hold means that token is wrong; a
      // request issued before the user signed in may land after the store changed.
      const used = (event as CustomEvent<{ token: string | null }>).detail?.token ?? null;
      const current = tokenStore.get();
      if (current && used === current) setAuthError('The daemon rejected that token. Check the value and try again.');
      setShowAuthModal(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    fetchInitialData();
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const token = authTokenInput.trim();
    if (!token) return;
    tokenStore.set(token);
    setAuthTokenInput('');
    setAuthError(null);
    setShowAuthModal(false);
    // Remount the page components so their own initial loads run again.
    setAuthEpoch((n) => n + 1);
    fetchInitialData();
  };

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setStatusNotification({ type, message });
    setTimeout(() => setStatusNotification(null), 4000);
  };

  const fetchInitialData = async () => {
    try {
      const [agentsRes, instancesRes, personasRes, roomsRes, usersRes] = await Promise.all([
        apiFetch('/api/v1/agents').catch(() => []),
        apiFetch('/api/v1/instances').catch(() => []),
        apiFetch('/api/v1/personas').catch(() => []),
        apiFetch('/api/v1/rooms').catch(() => []),
        apiFetch('/api/v1/users').catch(() => []),
      ]);

      setInstallations(Array.isArray(agentsRes) ? agentsRes : []);
      setInstances(Array.isArray(instancesRes) ? instancesRes : []);
      setPersonas(Array.isArray(personasRes) ? personasRes : []);

      // Identity: replace the old hardcoded sender with selectable local
      // profiles; seed one on first use.
      let userList = Array.isArray(usersRes) ? usersRes : [];
      if (userList.length === 0) {
        const created = await apiFetch<{ id: string; displayName: string; avatar?: string }>('/api/v1/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: 'Local User', avatar: '👤' }),
        }).catch(() => null);
        if (created?.id) userList = [created];
      }
      setUsers(userList);
      setCurrentUserId((prev) => {
        const valid = prev && userList.some((u: { id: string }) => u.id === prev) ? prev : userList[0]?.id ?? null;
        try {
          if (valid) window.localStorage.setItem('agentdeck-user-id', valid);
        } catch {
          // storage unavailable
        }
        return valid;
      });
      const roomList = Array.isArray(roomsRes) ? roomsRes : [];
      setRooms(roomList);
      if (roomList.length > 0) {
        const initialRoom = currentRoom ? roomList.find((r: Room) => r.id === currentRoom.id) || roomList[0] : roomList[0];
        setCurrentRoom(initialRoom);
        loadRoomData(initialRoom.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadRoomData = async (roomId: string) => {
    try {
      const [msgsRes, membersRes] = await Promise.all([
        apiFetch<Message[] | { items: Message[]; nextCursor?: string; hasMore?: boolean }>(
          `/api/v1/rooms/${roomId}/messages?limit=50`
        ).catch(() => [] as Message[]),
        apiFetch<RoomMember[]>(`/api/v1/rooms/${roomId}/members`).catch(() => [] as RoomMember[]),
      ]);
      if (Array.isArray(msgsRes)) {
        // Older server without pagination: plain array, nothing further to page.
        setMessages(msgsRes);
        setOlderCursor(null);
        setHasOlder(false);
      } else if (msgsRes && Array.isArray(msgsRes.items)) {
        setMessages(msgsRes.items);
        setOlderCursor(msgsRes.nextCursor ?? null);
        setHasOlder(Boolean(msgsRes.hasMore));
      }
      if (Array.isArray(membersRes)) setRoomMembers(membersRes);
    } catch (e) {
      console.error(e);
    }
  };

  const handleLoadOlder = async () => {
    if (!currentRoom || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const container = messagesScrollRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    try {
      const page = await apiFetch<{ items: Message[]; nextCursor?: string; hasMore?: boolean }>(
        `/api/v1/rooms/${currentRoom.id}/messages?limit=50&before=${encodeURIComponent(olderCursor)}`
      );
      if (page && Array.isArray(page.items)) {
        setMessages((prev) => [...page.items, ...prev]);
        setOlderCursor(page.nextCursor ?? null);
        setHasOlder(Boolean(page.hasMore));
        // Keep the viewport anchored on the message the user was reading.
        requestAnimationFrame(() => {
          if (container) container.scrollTop += container.scrollHeight - previousHeight;
        });
      }
    } catch (err) {
      console.error(err);
      showToast('error', 'Failed to load older messages');
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSelectRoom = (room: Room) => {
    setCurrentRoom(room);
    loadRoomData(room.id);
  };

  const currentUser = users.find((u) => u.id === currentUserId) ?? null;

  const handleSelectUser = (id: string) => {
    setCurrentUserId(id);
    try {
      window.localStorage.setItem('agentdeck-user-id', id);
    } catch {
      // storage unavailable
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !currentRoom || isSending) return;
    const prompt = chatInput.trim();
    setChatInput('');
    setIsSending(true);

    try {
      const data = await apiFetch<{
        deliveryTrace?: { state: string; feedbackMessage?: string };
        status?: string;
      }>(`/api/v1/rooms/${currentRoom.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          userId: currentUser?.id ?? 'user-default',
          userName: currentUser?.displayName ?? 'User',
        }),
      });
      if (data?.deliveryTrace && data.deliveryTrace.state === 'no_target') {
        showToast('info', data.deliveryTrace.feedbackMessage || '');
      }
      if (data?.status === 'cancelled') {
        showToast('info', 'Run stopped.');
      }
      await loadRoomData(currentRoom.id);
    } catch (err) {
      console.error(err);
      showToast('error', (err as Error).message || 'Failed to dispatch message');
    } finally {
      setIsSending(false);
    }
  };

  // Room-scoped abort needs no runId, so the stop button works even before a
  // run:started event could tell us which run is live.
  const handleStopRun = async () => {
    if (!currentRoom) return;
    try {
      // Prefer the precise runId (learned from run:started over /ws); the
      // room-scoped abort covers the window before that event arrives.
      if (activeRunId) {
        await apiFetch(`/api/v1/runs/${activeRunId}/abort`, { method: 'POST' });
      } else {
        await apiFetch(`/api/v1/rooms/${currentRoom.id}/abort`, { method: 'POST' });
      }
    } catch (err) {
      console.error(err);
      showToast('error', 'Failed to stop the run');
    }
  };

  // Live deck events for the room being viewed: token streaming, run
  // lifecycle, and messages posted by other clients.
  useEventStream(currentRoom?.id ?? null, (envelope: StreamEnvelope) => {
    const roomMatches = !envelope.roomId || envelope.roomId === currentRoom?.id;
    if (!roomMatches) return;

    switch (envelope.type) {
      case 'run:started': {
        const runId = (envelope.payload as { runId?: string } | undefined)?.runId ?? envelope.runId;
        if (runId) setActiveRunId(runId);
        break;
      }
      case 'run:chunk': {
        const p = envelope.payload as
          | { instanceId?: string; instanceName?: string; text?: string }
          | undefined;
        if (!p?.instanceId || !p.text) break;
        setStreamingTurns((prev) => ({
          ...prev,
          [p.instanceId!]: {
            instanceName: p.instanceName ?? 'agent',
            text: (prev[p.instanceId!]?.text ?? '') + p.text,
          },
        }));
        break;
      }
      case 'message:created': {
        const msg = (envelope.payload as { message?: Message } | undefined)?.message;
        if (!msg || msg.roomId !== currentRoom?.id) break;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        // The persisted message replaces the sender's ephemeral bubble.
        const senderId = msg.senderId;
        if (senderId) {
          setStreamingTurns((prev) => {
            if (!(senderId in prev)) return prev;
            const next = { ...prev };
            delete next[senderId];
            return next;
          });
        }
        break;
      }
      case 'run:turn:completed':
      case 'run:turn:failed': {
        const p = envelope.payload as { instanceId?: string } | undefined;
        if (!p?.instanceId) break;
        setStreamingTurns((prev) => {
          if (!(p.instanceId! in prev)) return prev;
          const next = { ...prev };
          delete next[p.instanceId!];
          return next;
        });
        break;
      }
      case 'run:completed':
      case 'run:cancelled':
      case 'run:failed': {
        setActiveRunId(null);
        setStreamingTurns({});
        break;
      }
      case 'room:deleted': {
        const p = envelope.payload as { roomId?: string } | undefined;
        if (p?.roomId && p.roomId === currentRoom?.id) {
          setCurrentRoom(null);
          setMessages([]);
          fetchInitialData();
        }
        break;
      }
      default:
        break;
    }
  });

  // Persona Management
  const openCreatePersona = () => {
    setEditingPersona(null);
    setPersonaForm({
      name: '',
      role: '',
      language: 'pt-BR',
      avatarEmoji: '🤖',
      systemPromptOverlay: '',
      responseStyle: '',
    });
    setShowPersonaModal(true);
  };

  const openEditPersona = (p: Persona) => {
    setEditingPersona(p);
    setPersonaForm({
      name: p.name,
      role: p.role,
      language: p.language,
      avatarEmoji: p.avatarEmoji,
      systemPromptOverlay: p.systemPromptOverlay,
      responseStyle: p.responseStyle || '',
    });
    setShowPersonaModal(true);
  };

  const handleSavePersona = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingPersona) {
        await apiFetch(`/api/v1/personas/${editingPersona.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(personaForm),
        });
        showToast('success', `Persona "${personaForm.name}" updated`);
      } else {
        await apiFetch('/api/v1/personas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(personaForm),
        });
        showToast('success', `Persona "${personaForm.name}" created`);
      }
      setShowPersonaModal(false);
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleDuplicatePersona = async (id: string) => {
    try {
      await apiFetch(`/api/v1/personas/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      showToast('success', 'Persona duplicated successfully');
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleDeletePersona = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete persona "${name}"?`)) return;
    try {
      await apiFetch(`/api/v1/personas/${id}`, { method: 'DELETE' });
      showToast('success', `Persona "${name}" deleted`);
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  // AgentInstance Management
  const openCreateInstance = () => {
    setEditingInstance(null);
    setInstanceForm({
      name: '',
      installationId: installations[0]?.id || '',
      personaId: personas[0]?.id || '',
      modelAlias: '',
      permissionTier: 'developer',
      isActive: true,
    });
    setShowInstanceModal(true);
  };

  const openEditInstance = (inst: AgentInstance) => {
    setEditingInstance(inst);
    setInstanceForm({
      name: inst.name,
      installationId: inst.installation.id || inst.installationId,
      personaId: inst.personaId || inst.persona.id,
      modelAlias: inst.modelAlias || '',
      permissionTier: inst.permissionTier || 'developer',
      isActive: inst.isActive !== false,
    });
    setShowInstanceModal(true);
  };

  const handleSaveInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingInstance) {
        await apiFetch(`/api/v1/instances/${editingInstance.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: instanceForm.name,
            personaId: instanceForm.personaId,
            modelAlias: instanceForm.modelAlias || null,
            permissionTier: instanceForm.permissionTier,
            isActive: instanceForm.isActive,
          }),
        });
        showToast('success', `Agent "${instanceForm.name}" updated`);
      } else {
        await apiFetch('/api/v1/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(instanceForm),
        });
        showToast('success', `Agent "${instanceForm.name}" created`);
      }
      setShowInstanceModal(false);
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleToggleInstanceActive = async (inst: AgentInstance) => {
    try {
      const nextActive = !inst.isActive;
      await apiFetch(`/api/v1/instances/${inst.id}/toggle-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
      showToast('info', `Agent "${inst.name}" is now ${nextActive ? 'Active' : 'Disabled'}`);
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleDeleteInstance = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete agent instance "${name}"?`)) return;
    try {
      await apiFetch(`/api/v1/instances/${id}`, { method: 'DELETE' });
      showToast('success', `Agent "${name}" deleted`);
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleDeleteRoom = async () => {
    if (!currentRoom) return;
    if (!confirm(`Delete room "${currentRoom.name}"? Its messages and history are removed permanently.`)) return;
    try {
      await apiFetch(`/api/v1/rooms/${currentRoom.id}`, { method: 'DELETE' });
      showToast('success', `Room "${currentRoom.name}" deleted`);
      setShowRoomSettingsModal(false);
      setCurrentRoom(null);
      setMessages([]);
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  // Room Member & Default Agent Management
  const handleSetRoomDefaultAgent = async (instanceId: string | null) => {
    if (!currentRoom) return;
    try {
      const updated = await apiFetch<Room>(`/api/v1/rooms/${currentRoom.id}/default-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultAgentInstanceId: instanceId }),
      });
      setCurrentRoom(updated);
      showToast('success', instanceId ? 'Default agent assigned' : 'Default agent cleared');
      fetchInitialData();
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleToggleRoomMember = async (instanceId: string) => {
    if (!currentRoom) return;
    const isMember = roomMembers.some((m) => m.memberId === instanceId && m.memberType === 'agent_instance');
    try {
      if (isMember) {
        await apiFetch(`/api/v1/rooms/${currentRoom.id}/members/${instanceId}`, { method: 'DELETE' });
        showToast('info', 'Agent removed from room');
      } else {
        await apiFetch(`/api/v1/rooms/${currentRoom.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberType: 'agent_instance', memberId: instanceId, role: 'participant' }),
        });
        showToast('success', 'Agent added to room');
      }
      loadRoomData(currentRoom.id);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const openRoomSettings = () => {
    if (!currentRoom) return;
    setShowRoomSettingsModal(true);
  };

  const openCreateRoomModal = () => {
    setCreateRoomForm({ name: '', description: '', mode: 'mention', memberInstanceIds: [] });
    setShowCreateRoomModal(true);
  };

  const toggleCreateRoomMember = (instanceId: string) => {
    setCreateRoomForm((prev) => ({
      ...prev,
      memberInstanceIds: prev.memberInstanceIds.includes(instanceId)
        ? prev.memberInstanceIds.filter((id) => id !== instanceId)
        : [...prev.memberInstanceIds, instanceId],
    }));
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createRoomForm.name.trim();
    if (!name) {
      showToast('error', 'Room name is required');
      return;
    }
    setCreatingRoom(true);
    try {
      const created = await apiFetch<Room>('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: createRoomForm.description.trim(),
          mode: createRoomForm.mode,
          memberInstanceIds: createRoomForm.memberInstanceIds,
          defaultAgentInstanceId: createRoomForm.memberInstanceIds[0] ?? null,
        }),
      });

      // Refresh room list and switch to the new room immediately (no page reload).
      const roomsRes = await apiFetch('/api/v1/rooms').catch(() => []);
      setRooms(Array.isArray(roomsRes) ? roomsRes : []);
      setCurrentRoom(created);
      await loadRoomData(created.id);

      setShowCreateRoomModal(false);
      showToast('success', `Room #${created.name} created`);

      // No agents selected -> immediately guide the user into adding one.
      if (createRoomForm.memberInstanceIds.length === 0) {
        setShowRoomSettingsModal(true);
      }
    } catch (err) {
      showToast('error', (err as Error).message);
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleInspectPrompt = async () => {
    if (instances.length === 0) return;
    try {
      const data = await apiFetch<InspectedPromptData>('/api/v1/inspect-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: instances[0]?.id,
          triggerMessage: 'Design the microservice architecture and security model.',
        }),
      });
      setInspectedPrompt(data);
    } catch (e) {
      console.error(e);
    }
  };

  const activeRoomMemberInstances = instances.filter((inst) =>
    roomMembers.some((m) => m.memberType === 'agent_instance' && m.memberId === inst.id)
  );

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Toast Notification */}
      {statusNotification && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border text-sm flex items-center gap-3 transition-all ${
            statusNotification.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : statusNotification.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : 'bg-cyan-950/90 border-cyan-500/50 text-cyan-200'
          }`}
        >
          {statusNotification.type === 'success' && <Check className="w-4 h-4 text-emerald-400" />}
          {statusNotification.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
          {statusNotification.type === 'info' && <Info className="w-4 h-4 text-cyan-400" />}
          <span>{statusNotification.message}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col justify-between">
        <div>
          <div className="p-4 border-b border-slate-800 flex items-center gap-2">
            <span className="text-xl">▲</span>
            <span className="font-bold text-lg tracking-wide text-cyan-400">AgentDeck</span>
            <span className="text-xs bg-cyan-950 text-cyan-400 border border-cyan-800 px-1.5 py-0.5 rounded ml-auto">
              v{WEB_APP_VERSION}
            </span>
          </div>

          <nav className="p-2 space-y-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'dashboard' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <Terminal className="w-4 h-4" /> Dashboard
            </button>
            <button
              onClick={() => setActiveTab('control')}
              data-testid="nav-control"
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'control' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <Zap className="w-4 h-4" /> Agent Control
            </button>
            <button
              onClick={() => setActiveTab('groups')}
              data-testid="nav-groups"
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'groups' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <Users className="w-4 h-4" /> Groups
            </button>
            <button
              onClick={() => setActiveTab('agents')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'agents' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <Bot className="w-4 h-4" /> Agent Instances
            </button>
            <button
              onClick={() => setActiveTab('personas')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'personas' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <UserCheck className="w-4 h-4" /> Persona Studio
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'chat' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <MessageSquare className="w-4 h-4" /> Group Chat Deck
            </button>
            <button
              onClick={() => {
                setActiveTab('prompt');
                handleInspectPrompt();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'prompt' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <Shield className="w-4 h-4" /> Prompt Studio / Inspector
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
          Local Daemon: <span className="text-emerald-400">{typeof window !== 'undefined' ? window.location.host : '127.0.0.1:4321'}</span>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/30">
          <div className="text-sm font-medium text-slate-300">
            {activeTab === 'dashboard' && 'Dashboard Overview'}
            {activeTab === 'agents' && 'Agent Instances & Engines'}
            {activeTab === 'personas' && 'Persona Identity Studio & Overlays'}
            {activeTab === 'chat' && `Room: #${currentRoom?.name || 'General'} (${currentRoom?.mode || 'mention'} mode)`}
            {activeTab === 'prompt' && 'Deterministic Prompt Composition Inspector'}
          </div>
          <button
            onClick={fetchInitialData}
            className="flex items-center gap-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh State
          </button>
        </header>

        {/* Tab Views */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 1. DASHBOARD */}
          {activeTab === 'control' && <AgentControlPage key={authEpoch} notify={(type, message) => setStatusNotification({ type, message })} />}
          {activeTab === 'groups' && <GroupsPage key={authEpoch} notify={(type, message) => setStatusNotification({ type, message })} />}

          {activeTab === 'dashboard' && (
            <div className="space-y-6 max-w-6xl">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Installed Runtimes</div>
                  <div className="text-2xl font-bold text-slate-100 mt-1">
                    {installations.filter((i) => i.state.installation === 'installed').length} / {installations.length}
                  </div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Active Agent Instances</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-1">
                    {instances.filter((i) => i.isActive !== false).length} / {instances.length}
                  </div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Personas Configured</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1">{personas.length}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Deterministic Routing</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5" /> Active v{WEB_APP_VERSION}
                  </div>
                </div>
              </div>

              {/* Blueprints Table */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
                <h3 className="font-semibold text-slate-200 mb-4">Host Machine Agent Runtimes</h3>
                <div className="space-y-3">
                  {installations.map((inst) => (
                    <div key={inst.id} className="flex items-center justify-between p-3 bg-slate-950/60 rounded-lg border border-slate-800/80">
                      <div>
                        <div className="font-semibold text-slate-200 capitalize">{inst.definitionId}</div>
                        <div className="text-xs text-slate-400">{inst.binaryPath || 'Binary not found'}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          {inst.versionInstalled ? `v${inst.versionInstalled}` : 'Uninstalled'}
                        </span>
                        {inst.state.installation === 'installed' ? (
                          <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full">
                            Installed
                          </span>
                        ) : (
                          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                            Available
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. AGENT INSTANCES */}
          {activeTab === 'agents' && (
            <div className="space-y-6 max-w-6xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-100">Configured Agent Instances</h3>
                  <p className="text-xs text-slate-400">Logical agent units configured on top of engine runtimes with persona overlays.</p>
                </div>
                <button
                  onClick={openCreateInstance}
                  className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Agent Instance
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {instances.map((i) => (
                  <div
                    key={i.id}
                    className={`bg-slate-900/60 border p-5 rounded-xl space-y-4 transition ${
                      i.isActive !== false ? 'border-slate-800' : 'border-slate-800/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{i.persona.avatarEmoji || '🤖'}</span>
                        <div>
                          <div className="font-bold text-slate-100 flex items-center gap-2">
                            {i.name}
                            {i.isActive !== false ? (
                              <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded">
                                Active
                              </span>
                            ) : (
                              <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.2 rounded">
                                Disabled
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-cyan-400">
                            {i.persona.name} ({i.persona.role})
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleInstanceActive(i)}
                          title={i.isActive !== false ? 'Disable Agent' : 'Enable Agent'}
                          className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-md"
                        >
                          {i.isActive !== false ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-slate-500" />}
                        </button>
                        <button
                          onClick={() => openEditInstance(i)}
                          title="Edit Instance"
                          className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-md"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteInstance(i.id, i.name)}
                          title="Delete Instance"
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Engine Runtime:</span>
                        <span className="font-medium text-slate-300 uppercase">{i.installation.definitionId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Language:</span>
                        <span className="font-medium text-slate-300">{i.persona.language}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Tier:</span>
                        <span className="font-medium text-slate-300 capitalize">{i.permissionTier}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. PERSONAS STUDIO */}
          {activeTab === 'personas' && (
            <div className="space-y-6 max-w-6xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg text-slate-100">Persona Identity Studio</h3>
                  <p className="text-xs text-slate-400">Reusable system prompt overlays, roles, languages, and response styles.</p>
                </div>
                <button
                  onClick={openCreatePersona}
                  className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" /> Create Persona
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {personas.map((p) => (
                  <div key={p.id} className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{p.avatarEmoji || '🤖'}</span>
                        <div>
                          <div className="font-bold text-slate-100">{p.name}</div>
                          <div className="text-xs text-cyan-400">{p.role}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDuplicatePersona(p.id)}
                          title="Duplicate Persona"
                          className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-md"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditPersona(p)}
                          title="Edit Persona"
                          className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-md"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePersona(p.id, p.name)}
                          title="Delete Persona (Safe Referential Check)"
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 space-y-2">
                      <div className="flex justify-between text-slate-500">
                        <span>Language: <span className="text-slate-300 font-medium">{p.language}</span></span>
                        <span>Style: <span className="text-slate-300 font-medium">{p.responseStyle || 'Normal'}</span></span>
                      </div>
                      <div>
                        <span className="font-medium text-slate-300">System Prompt Overlay:</span>
                        <p className="mt-1 line-clamp-3 text-slate-400 font-mono text-[11px] bg-slate-900/60 p-2 rounded">
                          {p.systemPromptOverlay || 'No custom system prompt overlay.'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. CHAT DECK */}
          {activeTab === 'chat' && (
            <div className="flex h-full gap-4 max-w-7xl">
              {/* Room list & Active Members bar */}
              <div className="w-72 bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Rooms</span>
                      <button
                        onClick={openCreateRoomModal}
                        title="Create a new room"
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Create Room
                      </button>
                    </div>
                    <div className="space-y-1">
                      {rooms.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => handleSelectRoom(r)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition ${
                            currentRoom?.id === r.id ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
                          }`}
                        >
                          <span>#{r.name}</span>
                          <span className="text-[10px] uppercase font-mono px-1 rounded bg-slate-800 text-slate-400">{r.mode}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Room Members & Routing Controls */}
                  {currentRoom && (
                    <div className="border-t border-slate-800 pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Room Members</span>
                        <button
                          onClick={() => setShowRoomSettingsModal(true)}
                          className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                        >
                          <Settings className="w-3 h-3" /> Manage
                        </button>
                      </div>

                      {/* Active Member Agents */}
                      <div className="space-y-1.5">
                        {activeRoomMemberInstances.length === 0 ? (
                          <div className="text-xs text-amber-400/80 bg-amber-950/30 p-2 rounded border border-amber-800/40 space-y-2">
                            <div>⚠️ 0 active agents in room. Messages will not trigger responses.</div>
                            <button
                              onClick={openRoomSettings}
                              className="w-full flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold px-2 py-1.5 rounded-lg text-[11px] transition"
                            >
                              <Plus className="w-3 h-3" /> Add Agent to Room
                            </button>
                          </div>
                        ) : (
                          activeRoomMemberInstances.map((inst) => {
                            const isDefault = currentRoom.defaultAgentInstanceId === inst.id;
                            return (
                              <div
                                key={inst.id}
                                className={`flex items-center justify-between p-2 rounded-lg text-xs border ${
                                  isDefault ? 'bg-cyan-950/40 border-cyan-800 text-cyan-300' : 'bg-slate-950/60 border-slate-800/60 text-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span>{inst.persona.avatarEmoji || '🤖'}</span>
                                  <span className="font-semibold">{inst.name}</span>
                                </div>
                                {isDefault && (
                                  <span className="text-[10px] bg-cyan-900 text-cyan-300 px-1 rounded font-mono">
                                    Default
                                  </span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Routing Mode Diagnostics */}
                      <div className="mt-3 text-[11px] text-slate-400 bg-slate-950/80 p-2.5 rounded border border-slate-800/80 space-y-1">
                        <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-cyan-400" /> Routing Strategy:
                        </div>
                        {currentRoom.mode === 'mention' && (
                          <p>
                            {activeRoomMemberInstances.length === 1
                              ? 'Single agent auto-routed on plain message.'
                              : currentRoom.defaultAgentInstanceId
                              ? 'Plain messages auto-routed to Default Agent.'
                              : 'Requires @mention or setting a default agent.'}
                          </p>
                        )}
                        {currentRoom.mode === 'panel' && <p>Broadcasts every message to all room members.</p>}
                        {currentRoom.mode === 'debate' && <p>Structured debate: the lead proposes, the other members critique, the lead synthesizes.</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Chat Viewport */}
              <div className="flex-1 flex flex-col h-full bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden">
                {/* Messages list */}
                <div ref={messagesScrollRef} className="flex-1 overflow-y-auto space-y-3 p-4">
                  {hasOlder && messages.length > 0 && (
                    <div className="text-center">
                      <button
                        onClick={handleLoadOlder}
                        disabled={loadingOlder}
                        className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                      >
                        {loadingOlder ? 'Loading…' : '↑ Load older messages'}
                      </button>
                    </div>
                  )}
                  {messages.length === 0 ? (
                    <div className="text-center text-slate-500 py-16 space-y-2">
                      <p className="text-sm">No messages in room #{currentRoom?.name} yet.</p>
                      <p className="text-xs text-slate-600">Send a message or mention @agent to start.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isSystem = m.contentType === 'system' || m.senderType === 'system';
                      const isAgent = m.senderType === 'agent_instance';
                      const trace = m.deliveryTrace;

                      return (
                        <div key={m.id} className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className={`font-semibold ${isAgent ? 'text-cyan-400' : isSystem ? 'text-amber-400' : 'text-slate-200'}`}>
                              {m.senderDisplayName}
                            </span>
                            <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                            {trace && (
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-mono border ${
                                  trace.state === 'running' || trace.state === 'completed'
                                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                    : trace.state === 'no_target'
                                    ? 'bg-amber-950 text-amber-400 border-amber-800'
                                    : 'bg-rose-950 text-rose-400 border-rose-800'
                                }`}
                              >
                                {trace.reasonCode}
                              </span>
                            )}
                          </div>
                          {trace?.state === 'no_target' && (
                            <div className="bg-amber-950/25 border border-amber-800/40 rounded-lg p-2.5 text-xs text-amber-200 space-y-2">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                                <div className="space-y-1">
                                  <div>{trace.feedbackMessage}</div>
                                  {trace.actionableHint && (
                                    <div className="text-amber-300/70">{trace.actionableHint}</div>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={openRoomSettings}
                                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold px-3 py-1.5 rounded-lg text-[11px] transition"
                              >
                                <Plus className="w-3 h-3" /> Add Agent to Room
                              </button>
                            </div>
                          )}
                          <div
                            className={`p-3 rounded-lg text-sm whitespace-pre-wrap border ${
                              isSystem
                                ? 'bg-amber-950/20 border-amber-800/40 text-amber-200'
                                : isAgent
                                ? 'bg-slate-950 border-slate-800 text-slate-200'
                                : 'bg-slate-900/80 border-slate-700/80 text-slate-100'
                            }`}
                          >
                            {m.content}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {/* Ephemeral live-stream bubbles: replaced by the persisted
                      message as soon as message:created lands. */}
                  {Object.entries(streamingTurns).map(([instanceId, turn]) => (
                    <div key={`stream-${instanceId}`} className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-cyan-400">{turn.instanceName}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded font-mono border bg-cyan-950 text-cyan-400 border-cyan-800 animate-pulse">
                          streaming
                        </span>
                      </div>
                      <div className="p-3 rounded-lg text-sm whitespace-pre-wrap border bg-slate-950 border-cyan-900/60 text-slate-300">
                        {turn.text}
                        <span className="animate-pulse">▍</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Input form */}
                <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-900/60 flex gap-2">
                  <select
                    value={currentUserId ?? ''}
                    onChange={(e) => handleSelectUser(e.target.value)}
                    title="Sending as"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2.5 text-sm text-slate-300 max-w-[140px]"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.avatar || '👤'} {u.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={
                      activeRoomMemberInstances.length === 0
                        ? 'No active agents in room. Add agents in settings...'
                        : 'Type message or use @agent, @all...'
                    }
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                  />
                  {(isSending || activeRunId !== null) ? (
                    <button
                      type="button"
                      onClick={handleStopRun}
                      className="bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
                    >
                      ■ Stop
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="bg-cyan-600 hover:bg-cyan-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" /> Send
                    </button>
                  )}
                </form>
              </div>
            </div>
          )}

          {/* 5. PROMPT STUDIO */}
          {activeTab === 'prompt' && (
            <div className="space-y-6 max-w-5xl">
              <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
                <h3 className="font-semibold text-slate-100 mb-2">Deterministic Prompt Layer Provenance</h3>
                <p className="text-xs text-slate-400 mb-4">
                  AgentDeck constructs dynamic prompt overlays deterministically without modifying upstream native configuration files.
                </p>

                {inspectedPrompt && (
                  <div className="space-y-3">
                    <div className="text-xs text-emerald-400 font-mono">
                      Estimated Tokens: {inspectedPrompt.totalEstimatedTokens?.value}
                    </div>
                    {inspectedPrompt.layers?.map((layer: PromptLayer) => (
                      <div key={layer.id} className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-cyan-400">
                            Layer {layer.order}: {layer.layerName}
                          </span>
                          <span className="text-slate-500">Source: {layer.source}</span>
                        </div>
                        <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono mt-2 bg-slate-900/80 p-2 rounded">
                          {layer.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL: PERSONA CREATE / EDIT */}
      {showPersonaModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100">
                {editingPersona ? 'Edit Persona' : 'Create New Persona'}
              </h3>
              <button onClick={() => setShowPersonaModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePersona} className="space-y-4 text-xs">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="block text-slate-400 mb-1">Avatar Emoji</label>
                  <input
                    type="text"
                    required
                    value={personaForm.avatarEmoji}
                    onChange={(e) => setPersonaForm({ ...personaForm, avatarEmoji: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-center text-lg"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-slate-400 mb-1">Persona Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Atlas, Sentinel, Nova"
                    value={personaForm.name}
                    onChange={(e) => setPersonaForm({ ...personaForm, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Role / Specialization</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Senior Architect, Code Reviewer, Security Specialist"
                  value={personaForm.role}
                  onChange={(e) => setPersonaForm({ ...personaForm, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Language Directive</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. pt-BR, en-US"
                    value={personaForm.language}
                    onChange={(e) => setPersonaForm({ ...personaForm, language: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Response Style (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. concise, technical, academic"
                    value={personaForm.responseStyle}
                    onChange={(e) => setPersonaForm({ ...personaForm, responseStyle: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">System Prompt Overlay</label>
                <textarea
                  rows={4}
                  placeholder="Inject non-destructive system instructions for this persona..."
                  value={personaForm.systemPromptOverlay}
                  onChange={(e) => setPersonaForm({ ...personaForm, systemPromptOverlay: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono text-[11px]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPersonaModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-semibold"
                >
                  Save Persona
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: AGENT INSTANCE CREATE / EDIT */}
      {showInstanceModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100">
                {editingInstance ? 'Edit Agent Instance' : 'Create Agent Instance'}
              </h3>
              <button onClick={() => setShowInstanceModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveInstance} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Instance Display Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Claude Senior, Hermes Reviewer"
                  value={instanceForm.name}
                  onChange={(e) => setInstanceForm({ ...instanceForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Engine Runtime</label>
                  <select
                    disabled={!!editingInstance}
                    value={instanceForm.installationId}
                    onChange={(e) => setInstanceForm({ ...instanceForm, installationId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 disabled:opacity-50"
                  >
                    {installations.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.definitionId} ({inst.state.installation})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Assigned Persona</label>
                  <select
                    value={instanceForm.personaId}
                    onChange={(e) => setInstanceForm({ ...instanceForm, personaId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                  >
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.avatarEmoji || '🤖'} {p.name} ({p.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Permission Tier</label>
                  <select
                    value={instanceForm.permissionTier}
                    onChange={(e) => setInstanceForm({ ...instanceForm, permissionTier: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                  >
                    <option value="safe">Safe (Read-Only)</option>
                    <option value="developer">Developer (Workspace)</option>
                    <option value="autonomous">Autonomous (Full Access)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Model Alias (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. claude-3-7-sonnet"
                    value={instanceForm.modelAlias}
                    onChange={(e) => setInstanceForm({ ...instanceForm, modelAlias: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="instActive"
                  checked={instanceForm.isActive}
                  onChange={(e) => setInstanceForm({ ...instanceForm, isActive: e.target.checked })}
                  className="rounded border-slate-800 text-cyan-600 focus:ring-0"
                />
                <label htmlFor="instActive" className="text-slate-300">
                  Agent Instance is Active (Eligible for Room Routing)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInstanceModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-semibold"
                >
                  Save Instance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ROOM SETTINGS & DEFAULT AGENT */}
      {showRoomSettingsModal && currentRoom && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100">
                Room #{currentRoom.name} Settings & Members
              </h3>
              <button onClick={() => setShowRoomSettingsModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Default Agent selector */}
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">
                  Default Agent (Receives plain untagged messages in Mention mode)
                </label>
                <select
                  value={currentRoom.defaultAgentInstanceId || ''}
                  onChange={(e) => handleSetRoomDefaultAgent(e.target.value ? e.target.value : null)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                >
                  <option value="">None (Explicit @mention required)</option>
                  {instances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.persona.avatarEmoji || '🤖'} {inst.name} ({inst.persona.role})
                    </option>
                  ))}
                </select>
              </div>

              {/* Room Member Checklist */}
              <div>
                <label className="block text-slate-400 mb-2 font-semibold">Room Member Agents</label>
                <div className="space-y-2 max-h-56 overflow-y-auto border border-slate-800 rounded-xl p-3 bg-slate-950">
                  {instances.length === 0 ? (
                    <div className="text-slate-500">No agent instances configured yet.</div>
                  ) : (
                    instances.map((inst) => {
                      const isMember = roomMembers.some((m) => m.memberId === inst.id && m.memberType === 'agent_instance');
                      return (
                        <div
                          key={inst.id}
                          onClick={() => handleToggleRoomMember(inst.id)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition border ${
                            isMember ? 'bg-cyan-950/30 border-cyan-800 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{inst.persona.avatarEmoji || '🤖'}</span>
                            <span className="font-semibold">{inst.name}</span>
                            <span className="text-[10px] text-slate-500">({inst.persona.role})</span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded ${isMember ? 'bg-cyan-800 text-white' : 'bg-slate-800 text-slate-500'}`}>
                            {isMember ? 'Member' : 'Not in Room'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex justify-between pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleDeleteRoom}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 rounded-lg text-white font-semibold flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Room
                </button>
                <button
                  type="button"
                  onClick={() => setShowRoomSettingsModal(false)}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE ROOM */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base text-slate-100">Create Room</h3>
              <button onClick={() => setShowCreateRoomModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRoom} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Room Name</label>
                <input
                  type="text"
                  autoFocus
                  value={createRoomForm.name}
                  onChange={(e) => setCreateRoomForm({ ...createRoomForm, name: e.target.value })}
                  placeholder="architecture-review"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Description</label>
                <input
                  type="text"
                  value={createRoomForm.description}
                  onChange={(e) => setCreateRoomForm({ ...createRoomForm, description: e.target.value })}
                  placeholder="What is this room for?"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Chat Mode</label>
                <select
                  value={createRoomForm.mode}
                  onChange={(e) =>
                    setCreateRoomForm({ ...createRoomForm, mode: e.target.value as Room['mode'] })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                >
                  <option value="mention">mention — agents reply when @mentioned</option>
                  <option value="panel">panel — all agents answer in parallel</option>
                  <option value="debate">debate — structured multi-turn debate</option>
                  <option value="round_robin">round_robin — agents take turns</option>
                  <option value="coordinator">coordinator — a lead agent delegates</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-2 font-semibold">Initial Agents</label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-800 rounded-xl p-3 bg-slate-950">
                  {instances.length === 0 ? (
                    <div className="text-slate-500">
                      No agent instances configured yet. Create one in the Agents tab first.
                    </div>
                  ) : (
                    instances.map((inst) => {
                      const selected = createRoomForm.memberInstanceIds.includes(inst.id);
                      return (
                        <div
                          key={inst.id}
                          onClick={() => toggleCreateRoomMember(inst.id)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition border ${
                            selected
                              ? 'bg-cyan-950/30 border-cyan-800 text-cyan-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{inst.persona.avatarEmoji || '🤖'}</span>
                            <span className="font-semibold">{inst.name}</span>
                            <span className="text-[10px] text-slate-500">({inst.persona.role})</span>
                          </div>
                          {selected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  The first selected agent becomes the room's Default Agent (answers untagged messages).
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateRoomModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingRoom || !createRoomForm.name.trim()}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-white font-semibold"
                >
                  {creatingRoom ? 'Creating...' : 'Create Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: AUTH TOKEN (daemon started with --token). Rendered last and
          above the other modals (z-[60]) so a 401 raised from inside one of
          them cannot leave this dialog hidden behind it. */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div
            ref={authDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <KeyRound className="w-5 h-5 text-cyan-400" />
              <h3 id="auth-modal-title" className="font-bold text-base text-slate-100">Authentication Required</h3>
            </div>

            <form onSubmit={handleUnlock} className="space-y-4 text-xs">
              <p className="text-slate-400">
                This Web Deck was started with <code className="font-mono text-cyan-300">--token</code>. Paste the token to continue.
              </p>

              <div>
                <label htmlFor="authToken" className="block text-slate-400 mb-1 font-semibold">Access Token</label>
                <input
                  id="authToken"
                  type="password"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={authTokenInput}
                  onChange={(e) => setAuthTokenInput(e.target.value)}
                  placeholder="Paste the --token secret"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              {authError && (
                <div className="flex items-start gap-2 text-rose-200 bg-rose-950/40 border border-rose-800/50 rounded-lg p-2.5" role="alert">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400" />
                  <span>{authError}</span>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  type="submit"
                  disabled={!authTokenInput.trim()}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-white font-semibold"
                >
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
