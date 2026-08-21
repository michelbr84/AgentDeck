import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { AgentDeckManager, ChatService } from '@agentdeck/core';
import { AgentInstallation, AgentInstance, Room, Message, Persona } from '@agentdeck/protocol';

export type TuiView = 'dashboard' | 'agents' | 'rooms' | 'chat' | 'docs';

export interface TuiOptions {
  initialView?: TuiView;
  initialRoom?: string;
}

export const TUI_VIEWS: TuiView[] = ['dashboard', 'agents', 'rooms', 'chat', 'docs'];

export const TuiApp: React.FC<TuiOptions> = ({ initialView = 'dashboard', initialRoom }) => {
  const { exit } = useApp();
  const [view, setView] = useState<TuiView>(initialView);
  const [manager, setManager] = useState<AgentDeckManager | null>(null);
  const [chatService, setChatService] = useState<ChatService | null>(null);
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [instances, setInstances] = useState<Array<AgentInstance & { persona: Persona; installation: AgentInstallation }>>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Welcome to AgentDeck Terminal Deck');
  const [isOrchestrating, setIsOrchestrating] = useState(false);

  useEffect(() => {
    async function init() {
      const mgr = await AgentDeckManager.create();
      setManager(mgr);
      setChatService(new ChatService(mgr));
      const instList = await mgr.scanAndSyncInstallations();
      setInstallations(instList);
      const instanceList = await mgr.listAgentInstances();
      setInstances(instanceList);
      const roomList = await mgr.listRooms();
      setRooms(roomList);

      if (initialRoom) {
        const found = roomList.find((r) => r.name === initialRoom || r.id === initialRoom);
        if (found) {
          setCurrentRoom(found);
          const msgs = await mgr.getRoomMessages(found.id);
          setMessages(msgs);
        }
      } else if (roomList.length > 0) {
        setCurrentRoom(roomList[0] || null);
        if (roomList[0]) {
          const msgs = await mgr.getRoomMessages(roomList[0].id);
          setMessages(msgs);
        }
      }
    }
    init();
  }, [initialRoom]);

  // Handle global and view navigation with terminal-portable keys
  useInput(
    (input, key) => {
      // Exit conditions
      if (key.escape) {
        if (isInputFocused) {
          setIsInputFocused(false);
          setStatusMessage('Navigation mode active (1-5, Tab, Arrows). Press "i" or Enter on Chat to type.');
          return;
        }
        exit();
        return;
      }
      if (key.ctrl && input === 'c') {
        exit();
        return;
      }

      // If user is actively typing in the chat TextInput, do not hijack normal typing
      if (isInputFocused) {
        return;
      }

      // Focus chat input explicitly with 'i' or Enter when in Chat view
      if (view === 'chat' && (input === 'i' || key.return)) {
        setIsInputFocused(true);
        setStatusMessage('Chat input focused. Type message and press Enter. (ESC to unfocus)');
        return;
      }

      // Portable Numeric Navigation: 1..5
      if (input === '1') setView('dashboard');
      if (input === '2') setView('agents');
      if (input === '3') setView('rooms');
      if (input === '4') setView('chat');
      if (input === '5') setView('docs');

      // Tab / Shift+Tab or Left/Right Arrow Navigation across views
      if (key.tab || key.rightArrow) {
        const currentIndex = TUI_VIEWS.indexOf(view);
        const nextIndex = key.shift
          ? (currentIndex - 1 + TUI_VIEWS.length) % TUI_VIEWS.length
          : (currentIndex + 1) % TUI_VIEWS.length;
        setView(TUI_VIEWS[nextIndex] || 'dashboard');
      } else if (key.leftArrow) {
        const currentIndex = TUI_VIEWS.indexOf(view);
        const prevIndex = (currentIndex - 1 + TUI_VIEWS.length) % TUI_VIEWS.length;
        setView(TUI_VIEWS[prevIndex] || 'dashboard');
      }
    },
    { isActive: process.stdin.isTTY }
  );

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !manager || !currentRoom) return;
    const content = chatInput.trim();
    setChatInput('');
    setIsInputFocused(false);

    setStatusMessage(`Sending prompt to #${currentRoom.name}...`);
    setIsOrchestrating(true);

    try {
      if (chatService) {
        const result = await chatService.send({
          roomId: currentRoom.id,
          content,
          senderUserId: 'local-user',
          senderDisplayName: 'Michel (You)',
        });
        setMessages(result.messages);
        setStatusMessage(`✔ Orchestration complete (${result.turnsExecuted} turns). Press "i" to type again.`);
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
      setIsOrchestrating(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      {/* Header Bar */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyanBright">
          ▲ AgentDeck v1.0.2 [Terminal Deck]
        </Text>
        <Text dimColor>
          [1:Dash | 2:Agents | 3:Rooms | 4:Chat | 5:Docs | Tab/Arrows:Nav | ESC:Exit]
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
            <Text bold>Configured Personas ({instances.length}):</Text>
            {instances.length === 0 ? (
              <Text dimColor> No instances configured yet. Use `agentdeck setup` to add.</Text>
            ) : (
              instances.map((i) => (
                <Text key={i.id}>
                  {' '}
                  {i.persona.avatarEmoji || '🤖'} <Text bold>{i.name}</Text> (
                  <Text color="cyan">{i.persona.role}</Text>) - Engine: {i.installation.definitionId} (
                  {i.persona.language})
                </Text>
              ))
            )}
          </Box>
        </Box>
      )}

      {view === 'agents' && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            🤖 Agent Blueprints & Configuration
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

      {view === 'rooms' && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            💬 Group Chat Rooms ({rooms.length})
          </Text>
          {rooms.map((room) => (
            <Box key={room.id} marginY={1}>
              <Text bold color="green">
                #{room.name}
              </Text>
              <Text dimColor> - Mode: {room.mode} | Turns Max: {room.maxTurnsPerRun}</Text>
            </Box>
          ))}
        </Box>
      )}

      {view === 'chat' && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            💬 Live Room: #{currentRoom?.name || 'general'} {isOrchestrating ? '(⚡ Orchestrating agents...)' : ''}
          </Text>
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
                  <Text bold color={m.senderType === 'user' ? 'cyan' : 'green'}>
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
          <Text>  agentdeck doctor     - Run Level 1/2 diagnostic health checks</Text>
          <Text>  agentdeck tui        - Launch this terminal user interface</Text>
          <Text>  agentdeck web        - Launch the browser-based Web Deck on port 4321</Text>
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

