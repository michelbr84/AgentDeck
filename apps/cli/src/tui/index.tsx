import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { AgentDeckManager, ChatService, RunAbortError } from '@agentdeck/core';
import { AgentInstallation, AgentInstance, Room, Message, Persona } from '@agentdeck/protocol';
import { AGENTDECK_VERSION } from '@agentdeck/shared';

export type TuiView = 'dashboard' | 'agents' | 'personas' | 'instances' | 'rooms' | 'chat' | 'docs';

export interface TuiOptions {
  initialView?: TuiView;
  initialRoom?: string;
}

export const TUI_VIEWS: TuiView[] = ['dashboard', 'agents', 'personas', 'instances', 'rooms', 'chat', 'docs'];

export const TuiApp: React.FC<TuiOptions> = ({ initialView = 'dashboard', initialRoom }) => {
  const { exit } = useApp();
  const [view, setView] = useState<TuiView>(initialView);
  const [manager, setManager] = useState<AgentDeckManager | null>(null);
  const [chatService, setChatService] = useState<ChatService | null>(null);
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [instances, setInstances] = useState<Array<AgentInstance & { persona: Persona; installation: AgentInstallation }>>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomMembers, setRoomMembers] = useState<Array<{ id: string; memberType: 'agent_instance' | 'user'; memberId: string; role: string }>>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Welcome to AgentDeck Terminal Deck');
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const runAbortRef = useRef<AbortController | null>(null);

  // Sub-navigation / selection indices inside management views
  const [selectedPersonaIndex, setSelectedPersonaIndex] = useState(0);
  const [selectedInstanceIndex, setSelectedInstanceIndex] = useState(0);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);

  // Form edit sub-modes
  const [editMode, setEditMode] = useState<'none' | 'edit_persona_prompt' | 'dup_persona' | 'edit_room_default'>('none');
  const [formInputText, setFormInputText] = useState('');

  const refreshData = async (mgr: AgentDeckManager) => {
    const instList = await mgr.scanAndSyncInstallations();
    setInstallations(instList);
    const instanceList = await mgr.listAgentInstances();
    setInstances(instanceList);
    const personaList = await mgr.listPersonas();
    setPersonas(personaList);
    const roomList = await mgr.listRooms();
    setRooms(roomList);
    if (currentRoom) {
      const refreshedRoom = roomList.find((r) => r.id === currentRoom.id) || roomList[0] || null;
      setCurrentRoom(refreshedRoom);
      if (refreshedRoom) {
        const msgs = await mgr.getRoomMessages(refreshedRoom.id);
        setMessages(msgs);
        const members = await mgr.listRoomMembers(refreshedRoom.id);
        setRoomMembers(members);
      }
    } else if (roomList.length > 0) {
      setCurrentRoom(roomList[0] || null);
      if (roomList[0]) {
        const msgs = await mgr.getRoomMessages(roomList[0].id);
        setMessages(msgs);
        const members = await mgr.listRoomMembers(roomList[0].id);
        setRoomMembers(members);
      }
    }
  };

  useEffect(() => {
    async function init() {
      const mgr = await AgentDeckManager.create();
      setManager(mgr);
      setChatService(new ChatService(mgr));
      await refreshData(mgr);

      if (initialRoom) {
        const roomList = await mgr.listRooms();
        const found = roomList.find((r) => r.name === initialRoom || r.id === initialRoom);
        if (found) {
          setCurrentRoom(found);
          const msgs = await mgr.getRoomMessages(found.id);
          setMessages(msgs);
          const members = await mgr.listRoomMembers(found.id);
          setRoomMembers(members);
        }
      }
    }
    init();
  }, [initialRoom]);

  // Handle global and view navigation with terminal-portable keys
  useInput(
    (input, key) => {
      // Exit / Cancel conditions
      if (key.escape) {
        if (isOrchestrating) {
          // ESC during a run stops the run, never the whole app.
          runAbortRef.current?.abort(new RunAbortError());
          setStatusMessage('⏹ Stopping run...');
          return;
        }
        if (editMode !== 'none') {
          setEditMode('none');
          setFormInputText('');
          setStatusMessage('Action cancelled.');
          return;
        }
        if (isInputFocused) {
          setIsInputFocused(false);
          setStatusMessage('Navigation mode active (1-7, Tab, Arrows). Press "i" or Enter on Chat to type.');
          return;
        }
        exit();
        return;
      }
      if (key.ctrl && input === 'c') {
        exit();
        return;
      }

      // If user is actively typing in modal edit or chat input
      if (editMode !== 'none' || isInputFocused) {
        return;
      }

      // Focus chat input explicitly with 'i' or Enter when in Chat view
      if (view === 'chat' && (input === 'i' || key.return)) {
        setIsInputFocused(true);
        setStatusMessage('Chat input focused. Type message and press Enter. (ESC to unfocus)');
        return;
      }

      // Portable Numeric Navigation: 1..7
      if (input === '1') setView('dashboard');
      if (input === '2') setView('agents');
      if (input === '3') setView('personas');
      if (input === '4') setView('instances');
      if (input === '5') setView('rooms');
      if (input === '6') setView('chat');
      if (input === '7') setView('docs');

      // Tab / Shift+Tab or Left/Right Arrow Navigation across views
      if (key.tab || key.rightArrow) {
        const currentIndex = TUI_VIEWS.indexOf(view);
        const nextIndex = key.shift
          ? (currentIndex - 1 + TUI_VIEWS.length) % TUI_VIEWS.length
          : (currentIndex + 1) % TUI_VIEWS.length;
        setView(TUI_VIEWS[nextIndex] || 'dashboard');
        return;
      } else if (key.leftArrow) {
        const currentIndex = TUI_VIEWS.indexOf(view);
        const prevIndex = (currentIndex - 1 + TUI_VIEWS.length) % TUI_VIEWS.length;
        setView(TUI_VIEWS[prevIndex] || 'dashboard');
        return;
      }

      // View-specific actions and arrow scrolling
      if (view === 'personas') {
        if (key.downArrow && personas.length > 0) {
          setSelectedPersonaIndex((prev) => (prev + 1) % personas.length);
        } else if (key.upArrow && personas.length > 0) {
          setSelectedPersonaIndex((prev) => (prev - 1 + personas.length) % personas.length);
        } else if (input === 'e' && personas[selectedPersonaIndex]) {
          // Edit System Prompt Overlay
          setEditMode('edit_persona_prompt');
          setFormInputText(personas[selectedPersonaIndex]?.systemPromptOverlay || '');
          setStatusMessage(`Editing overlay prompt for "${personas[selectedPersonaIndex]?.name}". Enter text and press Enter.`);
        } else if (input === 'c' && personas[selectedPersonaIndex]) {
          // Duplicate / Clone Persona
          setEditMode('dup_persona');
          setFormInputText(`${personas[selectedPersonaIndex]?.name} (Copy)`);
          setStatusMessage(`Duplicating "${personas[selectedPersonaIndex]?.name}". Type new name and press Enter.`);
        } else if (input === 'd' && personas[selectedPersonaIndex] && manager) {
          // Delete Persona with Safe 409 Conflict Handling
          const target = personas[selectedPersonaIndex]!;
          manager.deletePersona(target.id)
            .then(async () => {
              setStatusMessage(`✔ Persona "${target.name}" deleted successfully.`);
              await refreshData(manager);
              setSelectedPersonaIndex((prev) => Math.max(0, prev - 1));
            })
            .catch((err) => {
              setStatusMessage(`✖ Cannot delete persona: ${(err as Error).message}`);
            });
        }
      }

      if (view === 'instances') {
        if (key.downArrow && instances.length > 0) {
          setSelectedInstanceIndex((prev) => (prev + 1) % instances.length);
        } else if (key.upArrow && instances.length > 0) {
          setSelectedInstanceIndex((prev) => (prev - 1 + instances.length) % instances.length);
        } else if (input === 't' && instances[selectedInstanceIndex] && manager) {
          // Toggle Active
          const target = instances[selectedInstanceIndex]!;
          manager.toggleAgentInstanceActive(target.id)
            .then(async (updated) => {
              setStatusMessage(`✔ Instance "${target.name}" is now ${updated?.isActive ? 'ACTIVE' : 'INACTIVE'}.`);
              await refreshData(manager);
            })
            .catch((err) => {
              setStatusMessage(`✖ Error toggling instance: ${(err as Error).message}`);
            });
        } else if (input === 'd' && instances[selectedInstanceIndex] && manager) {
          // Delete Instance
          const target = instances[selectedInstanceIndex]!;
          manager.deleteAgentInstance(target.id)
            .then(async () => {
              setStatusMessage(`✔ Instance "${target.name}" removed.`);
              await refreshData(manager);
              setSelectedInstanceIndex((prev) => Math.max(0, prev - 1));
            })
            .catch((err) => {
              setStatusMessage(`✖ Error deleting instance: ${(err as Error).message}`);
            });
        }
      }

      if (view === 'rooms') {
        if (key.downArrow && rooms.length > 0) {
          const next = (selectedRoomIndex + 1) % rooms.length;
          setSelectedRoomIndex(next);
          const r = rooms[next];
          if (r && manager) {
            setCurrentRoom(r);
            manager.listRoomMembers(r.id).then(setRoomMembers);
            manager.getRoomMessages(r.id).then(setMessages);
          }
        } else if (key.upArrow && rooms.length > 0) {
          const prev = (selectedRoomIndex - 1 + rooms.length) % rooms.length;
          setSelectedRoomIndex(prev);
          const r = rooms[prev];
          if (r && manager) {
            setCurrentRoom(r);
            manager.listRoomMembers(r.id).then(setRoomMembers);
            manager.getRoomMessages(r.id).then(setMessages);
          }
        } else if (input === 's' && currentRoom && manager) {
          // Select as default room for chat
          setView('chat');
          setStatusMessage(`Switched active chat to #${currentRoom.name}. Press "i" to type.`);
        } else if (input === 'd' && currentRoom && manager) {
          // Edit Default Agent
          setEditMode('edit_room_default');
          setFormInputText(currentRoom.defaultAgentInstanceId || '');
          setStatusMessage(`Set Default Agent Instance ID for #${currentRoom.name} (or leave empty to clear):`);
        }
      }
    },
    { isActive: process.stdin.isTTY }
  );

  const handleFormSubmit = async () => {
    if (!manager) return;
    if (editMode === 'edit_persona_prompt' && personas[selectedPersonaIndex]) {
      const p = personas[selectedPersonaIndex]!;
      await manager.updatePersona(p.id, { systemPromptOverlay: formInputText });
      setStatusMessage(`✔ System prompt overlay updated for "${p.name}".`);
    } else if (editMode === 'dup_persona' && personas[selectedPersonaIndex]) {
      const p = personas[selectedPersonaIndex]!;
      await manager.duplicatePersona(p.id, formInputText.trim() || undefined);
      setStatusMessage(`✔ Duplicated persona "${p.name}" as "${formInputText.trim()}".`);
    } else if (editMode === 'edit_room_default' && currentRoom) {
      const val = formInputText.trim() || null;
      await manager.setDefaultAgentInstanceForRoom(currentRoom.id, val);
      setStatusMessage(`✔ Updated default agent for #${currentRoom.name}.`);
    }
    setEditMode('none');
    setFormInputText('');
    await refreshData(manager);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !manager || !currentRoom) return;
    const content = chatInput.trim();
    setChatInput('');
    setIsInputFocused(false);

    setStatusMessage(`Sending prompt to #${currentRoom.name}... (ESC stops the run)`);
    setIsOrchestrating(true);
    const abortController = new AbortController();
    runAbortRef.current = abortController;

    try {
      if (chatService) {
        const result = await chatService.send({
          roomId: currentRoom.id,
          content,
          senderUserId: 'local-user',
          senderDisplayName: 'Michel (You)',
          abortSignal: abortController.signal,
        });
        setMessages(result.messages);
        const reason = result.deliveryTrace?.reasonCode || 'executed';
        setStatusMessage(`✔ Trace: [${result.deliveryTrace?.state || 'done'}:${reason}] (${result.turnsExecuted} turns). Press "i" to type.`);
      } else {
        const msg = await manager.postMessage({
          roomId: currentRoom.id,
          senderType: 'user',
          senderId: 'local-user',
          senderDisplayName: 'Michel (You)',
          content,
        });
        setMessages((prev) => [...prev, msg]);
        setStatusMessage(`Message posted to #${currentRoom.name}. Press "i" to type again.`);
      }
    } catch (err) {
      setStatusMessage(`✖ Error executing turn: ${(err as Error).message}`);
    } finally {
      runAbortRef.current = null;
      setIsOrchestrating(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      {/* Header Bar */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyanBright">
          ▲ AgentDeck v{AGENTDECK_VERSION} [Terminal Deck]
        </Text>
        <Text dimColor>
          [1:Dash | 2:Engines | 3:Personas | 4:Instances | 5:Rooms | 6:Chat | 7:Docs | Tab/Arrows:Nav | ESC:Exit]
        </Text>
      </Box>

      {/* Main Content Area */}
      {view === 'dashboard' && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            📊 System Overview & Runtime Status
          </Text>
          <Box flexDirection="column" marginY={1}>
            <Text bold>Installed Agent Engines:</Text>
            {installations.map((inst) => (
              <Text key={inst.id}>
                {' '}
                {inst.state.installation === 'installed' ? '● ' : '○ '}
                <Text bold>{inst.definitionId.padEnd(14)}</Text> [
                {inst.versionInstalled ? `v${inst.versionInstalled}` : 'Not Installed'}]
                {inst.state.version === 'outdated' ? (
                  <Text color="yellow"> (Update Available)</Text>
                ) : null}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold>Configured Personas & Instances ({instances.length}):</Text>
            {instances.length === 0 ? (
              <Text dimColor> No instances configured yet. Use `agentdeck setup` or Personas view.</Text>
            ) : (
              instances.map((i) => (
                <Text key={i.id}>
                  {' '}
                  {i.persona.avatarEmoji || '🤖'} <Text bold color={i.isActive ? 'white' : 'gray'}>{i.name}</Text> (
                  <Text color="cyan">{i.persona.role}</Text>) - Engine: {i.installation.definitionId} [{i.isActive ? 'ACTIVE' : 'INACTIVE'}]
                </Text>
              ))
            )}
          </Box>
        </Box>
      )}

      {view === 'agents' && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            🤖 Agent Blueprints & Binaries ({installations.length})
          </Text>
          {installations.map((inst) => (
            <Box key={inst.id} flexDirection="column" marginY={1} padding={1} borderStyle="single">
              <Text bold color="cyan">
                {inst.definitionId.toUpperCase()}
              </Text>
              <Text>Binary Path: {inst.binaryPath || 'Not found'}</Text>
              <Text>Installed Version: {inst.versionInstalled || 'None'}</Text>
              <Text>Latest Available: {inst.versionLatest || 'Checking...'}</Text>
              <Text>Health Status: {inst.state.health}</Text>
            </Box>
          ))}
        </Box>
      )}

      {view === 'personas' && (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold color="yellow">
              🎭 Personas & System Prompt Overlays ({personas.length})
            </Text>
            <Text dimColor>[↑/↓:Select | e:Edit Overlay | c:Clone | d:Safe Delete]</Text>
          </Box>
          {personas.map((p, idx) => {
            const isSelected = idx === selectedPersonaIndex;
            return (
              <Box
                key={p.id}
                flexDirection="column"
                marginY={1}
                padding={1}
                borderStyle="single"
                borderColor={isSelected ? 'green' : 'gray'}
              >
                <Text bold color={isSelected ? 'greenBright' : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                  {p.avatarEmoji || '🤖'} {p.name} ({p.role}) - Lang: {p.language}
                </Text>
                <Text dimColor>  ID: {p.id}</Text>
                <Text>
                  <Text bold color="cyan">  System Prompt Overlay: </Text>
                  {p.systemPromptOverlay ? p.systemPromptOverlay.replace(/\n/g, ' ') : '(none - uses base adapter)'}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {view === 'instances' && (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold color="yellow">
              ⚡ Configured Agent Instances ({instances.length})
            </Text>
            <Text dimColor>[↑/↓:Select | t:Toggle Active/Inactive | d:Delete]</Text>
          </Box>
          {instances.map((inst, idx) => {
            const isSelected = idx === selectedInstanceIndex;
            return (
              <Box
                key={inst.id}
                flexDirection="column"
                marginY={1}
                padding={1}
                borderStyle="single"
                borderColor={isSelected ? 'green' : 'gray'}
              >
                <Text bold color={isSelected ? 'greenBright' : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                  {inst.persona.avatarEmoji || '🤖'} {inst.name} [Status: {inst.isActive ? 'ACTIVE' : 'INACTIVE'}]
                </Text>
                <Text dimColor>  ID: {inst.id} | Engine: {inst.installation.definitionId} | Persona: {inst.persona.name}</Text>
                <Text>  Permission: {inst.permissionTier} | Workspace: {inst.workspaceDir || 'default'}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {view === 'rooms' && (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold color="yellow">
              💬 Chat Rooms & Routing Settings ({rooms.length})
            </Text>
            <Text dimColor>[↑/↓:Select | s:Switch Chat Room | d:Set Default Agent]</Text>
          </Box>
          {rooms.map((room, idx) => {
            const isSelected = idx === selectedRoomIndex;
            return (
              <Box
                key={room.id}
                flexDirection="column"
                marginY={1}
                padding={1}
                borderStyle="single"
                borderColor={isSelected ? 'green' : 'gray'}
              >
                <Text bold color={isSelected ? 'greenBright' : 'green'}>
                  {isSelected ? '▶ ' : '  '}#{room.name} ({room.mode.toUpperCase()})
                </Text>
                <Text dimColor>  ID: {room.id} | Max Turns: {room.maxTurnsPerRun}</Text>
                <Text>
                  <Text bold color="cyan">  Default Agent: </Text>
                  {room.defaultAgentInstanceId ? room.defaultAgentInstanceId : '(none - requires @mention if multi-agent)'}
                </Text>
                {isSelected && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold color="yellow">  Members ({roomMembers.length}):</Text>
                    {roomMembers.map((m) => (
                      <Text key={m.id} dimColor>    - [{m.memberType}] {m.memberId} ({m.role})</Text>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {view === 'chat' && (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold color="yellow">
              💬 Live Room: #{currentRoom?.name || 'general'} {isOrchestrating ? '(⚡ Orchestrating agents...)' : ''}
            </Text>
            <Text dimColor>Default Agent: {currentRoom?.defaultAgentInstanceId || 'none'}</Text>
          </Box>
          <Box
            flexDirection="column"
            height={10}
            borderStyle="single"
            borderColor="gray"
            padding={1}
            marginBottom={1}
          >
            {messages.length === 0 ? (
              <Text dimColor>No messages in this room yet. Press "i" to write a prompt!</Text>
            ) : (
              messages.map((m) => (
                <Text key={m.id}>
                  <Text bold color={m.senderType === 'user' ? 'cyan' : m.contentType === 'system' ? 'yellow' : 'green'}>
                    [{m.senderDisplayName}]:
                  </Text>{' '}
                  {m.content}
                </Text>
              ))
            )}
          </Box>
          <Box>
            <Text bold color={isInputFocused ? 'green' : 'gray'}>
              Prompt {isInputFocused ? '[Typing >]' : '[Press "i" to type] >'}{' '}
            </Text>
            {process.stdin.isTTY ? (
              isInputFocused ? (
                <TextInput
                  value={chatInput}
                  onChange={setChatInput}
                  onSubmit={handleSendMessage}
                  placeholder="Type message or @agent tag (Press ESC to unfocus)..."
                />
              ) : (
                <Text dimColor>{chatInput || '(Inactive - Press "i" to focus and type)'}</Text>
              )
            ) : (
              <Text dimColor>Interactive input requires TTY terminal.</Text>
            )}
          </Box>
        </Box>
      )}

      {view === 'docs' && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            📖 AgentDeck Offline Documentation Manual
          </Text>
          <Box marginY={1}>
            <Text>
              AgentDeck is an autonomous, non-destructive multi-agent orchestrator and universal deck.
            </Text>
          </Box>
          <Text bold>Shortcuts & CLI Commands:</Text>
          <Text>  agentdeck setup      - Run full interactive onboarding & upgrade check</Text>
          <Text>  agentdeck status     - Check status and health matrix for all agents</Text>
          <Text>  agentdeck doctor [agentId] - Run Level 1/2 diagnostic health checks</Text>
          <Text>  agentdeck tui        - Launch this terminal user interface</Text>
          <Text>  agentdeck web        - Launch the browser-based Web Deck on port 4321</Text>
        </Box>
      )}

      {/* Modal / Inline Edit Bar */}
      {editMode !== 'none' && (
        <Box flexDirection="column" marginTop={1} padding={1} borderStyle="double" borderColor="yellow">
          <Text bold color="yellow">
            ✏️ {editMode === 'edit_persona_prompt' ? 'Edit System Prompt Overlay' : editMode === 'dup_persona' ? 'Duplicate Persona' : 'Set Default Agent Instance ID'}:
          </Text>
          <TextInput
            value={formInputText}
            onChange={setFormInputText}
            onSubmit={handleFormSubmit}
          />
          <Text dimColor>(Press Enter to save, ESC to cancel)</Text>
        </Box>
      )}

      {/* Footer Status Line */}
      <Box marginTop={1} borderStyle="single" borderColor="gray">
        <Text dimColor>Status: {statusMessage}</Text>
      </Box>
    </Box>
  );
};

export async function renderTui(options?: TuiOptions): Promise<void> {
  const { waitUntilExit } = render(React.createElement(TuiApp, options || {}), {
    patchConsole: false,
  });
  await waitUntilExit();
}
