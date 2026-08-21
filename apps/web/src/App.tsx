import React, { useState, useEffect } from 'react';
import { Bot, MessageSquare, Shield, Terminal, RefreshCw, Send, CheckCircle2 } from 'lucide-react';

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

interface AgentInstance {
  id: string;
  name: string;
  persona: {
    name: string;
    role: string;
    language: string;
    avatarEmoji: string;
    systemPromptOverlay: string;
  };
  installation: {
    definitionId: string;
  };
}

interface Room {
  id: string;
  name: string;
  mode: string;
  description: string;
}

interface Message {
  id: string;
  senderDisplayName: string;
  senderType: string;
  content: string;
  createdAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'agents' | 'chat' | 'prompt' | 'docs'>('dashboard');
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [inspectedPrompt, setInspectedPrompt] = useState<InspectedPromptData | null>(null);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const [agentsRes, instancesRes, roomsRes] = await Promise.all([
        fetch('/api/v1/agents').then((r) => r.json()).catch(() => []),
        fetch('/api/v1/instances').then((r) => r.json()).catch(() => []),
        fetch('/api/v1/rooms').then((r) => r.json()).catch(() => []),
      ]);

      setInstallations(Array.isArray(agentsRes) ? agentsRes : []);
      setInstances(Array.isArray(instancesRes) ? instancesRes : []);
      const roomList = Array.isArray(roomsRes) ? roomsRes : [];
      setRooms(roomList);
      if (roomList.length > 0 && !currentRoom) {
        setCurrentRoom(roomList[0]);
        loadMessages(roomList[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadMessages = async (roomId: string) => {
    try {
      const res = await fetch(`/api/v1/rooms/${roomId}/messages`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !currentRoom) return;
    const prompt = chatInput.trim();
    setChatInput('');

    // Post to room
    await fetch(`/api/v1/rooms/${currentRoom.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, userId: 'user-michel', userName: 'Michel' }),
    });

    await loadMessages(currentRoom.id);
  };

  const handleInspectPrompt = async () => {
    if (instances.length === 0) return;
    try {
      const res = await fetch('/api/v1/inspect-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: instances[0]?.id,
          triggerMessage: 'Design the microservice architecture and security model.',
        }),
      });
      const data = await res.json();
      setInspectedPrompt(data);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col justify-between">
        <div>
          <div className="p-4 border-b border-slate-800 flex items-center gap-2">
            <span className="text-xl">▲</span>
            <span className="font-bold text-lg tracking-wide text-cyan-400">AgentDeck</span>
            <span className="text-xs bg-cyan-950 text-cyan-400 border border-cyan-800 px-1.5 py-0.5 rounded ml-auto">
              v1.0
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
              onClick={() => setActiveTab('agents')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'agents' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <Bot className="w-4 h-4" /> Agent Engines & Personas
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
          Local Daemon: <span className="text-emerald-400">127.0.0.1:4321</span>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/30">
          <div className="text-sm font-medium text-slate-300">
            {activeTab === 'dashboard' && 'Dashboard Overview'}
            {activeTab === 'agents' && 'Agent Runtime Directory & Configuration'}
            {activeTab === 'chat' && `Room: #${currentRoom?.name || 'General'}`}
            {activeTab === 'prompt' && 'Deterministic Prompt Composition Inspector'}
          </div>
          <button
            onClick={fetchInitialData}
            className="flex items-center gap-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Sync Agents
          </button>
        </header>

        {/* Tab Views */}
        <div className="flex-1 overflow-y-auto p-6">
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
                  <div className="text-xs text-slate-400 font-medium">Configured Personas</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-1">{instances.length}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Active Rooms</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1">{rooms.length}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="text-xs text-slate-400 font-medium">Security & Redaction</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5" /> Enforced
                  </div>
                </div>
              </div>

              {/* Blueprints Table */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
                <h3 className="font-semibold text-slate-200 mb-4">Supported Agent Runtimes</h3>
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

          {activeTab === 'agents' && (
            <div className="space-y-6 max-w-6xl">
              <h3 className="font-semibold text-lg text-slate-100">Configured Personas & Agents</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {instances.map((i) => (
                  <div key={i.id} className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{i.persona.avatarEmoji || '🤖'}</span>
                      <div>
                        <div className="font-bold text-slate-100">{i.name}</div>
                        <div className="text-xs text-cyan-400">{i.persona.role}</div>
                      </div>
                      <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded ml-auto">
                        {i.persona.language}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                      <span className="font-medium text-slate-300">System Prompt Overlay:</span>
                      <p className="mt-1">{i.persona.systemPromptOverlay || 'Default agent behavior.'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="flex flex-col h-full max-w-5xl">
              {/* Messages viewport */}
              <div className="flex-1 overflow-y-auto space-y-4 p-4 bg-slate-900/40 border border-slate-800 rounded-xl mb-4">
                {messages.length === 0 ? (
                  <div className="text-center text-slate-500 py-12">No messages in room yet. Start the conversation!</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-cyan-400">{m.senderDisplayName}</span>
                        <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-sm whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message or use @Atlas, @Sentinel..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-slate-100"
                />
                <button
                  type="submit"
                  className="bg-cyan-600 hover:bg-cyan-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2"
                >
                  <Send className="w-4 h-4" /> Send
                </button>
              </form>
            </div>
          )}

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
    </div>
  );
}
