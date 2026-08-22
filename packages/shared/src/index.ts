import os from 'node:os';
import path from 'node:path';

export { AGENTDECK_VERSION } from './version.js';
export { AGENTDECK_BUILD_INFO, type AgentDeckBuildInfo } from './build-info.js';

export const AGENTDECK_PATHS = {
  get HOME_DIR() {
    return path.join(os.homedir(), '.agentdeck');
  },
  get CONFIG_FILE() {
    return path.join(this.HOME_DIR, 'config.yaml');
  },
  get SECRETS_DIR() {
    return path.join(this.HOME_DIR, 'secrets');
  },
  get DATA_DIR() {
    return path.join(this.HOME_DIR, 'data');
  },
  get DB_PATH() {
    return path.join(this.DATA_DIR, 'agentdeck.db');
  },
  get BACKUPS_DIR() {
    return path.join(this.HOME_DIR, 'backups');
  },
  get LOGS_DIR() {
    return path.join(this.HOME_DIR, 'logs');
  },
  get PLUGINS_DIR() {
    return path.join(this.HOME_DIR, 'plugins');
  },
  get PERSONAS_DIR() {
    return path.join(this.HOME_DIR, 'personas');
  },
  get APP_DIR() {
    return path.join(this.HOME_DIR, 'app');
  },
  get WEB_DIST_DIR() {
    return path.join(this.APP_DIR, 'web', 'dist');
  },
};

export const DEFAULT_SERVER_PORT = 4321;
export const DEFAULT_SERVER_HOST = '127.0.0.1';

export const SUPPORTED_LANGUAGES = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'es-ES', name: 'Español' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'ja-JP', name: '日本語' },
  { code: 'zh-CN', name: '简体中文' },
];

export const INITIAL_PERSONAS = [
  {
    id: 'persona-atlas',
    name: 'Atlas',
    role: 'Senior Software Architect & Systems Designer',
    language: 'pt-BR',
    systemPromptOverlay: 'You are Atlas, a senior software architect specializing in distributed systems, clean architecture, security, and scalability.',
    avatarEmoji: '🏛️',
    isTemplate: true,
  },
  {
    id: 'persona-sentinel',
    name: 'Sentinel',
    role: 'Security & Code Review Specialist',
    language: 'pt-BR',
    systemPromptOverlay: 'You are Sentinel, an expert in cybersecurity, secure code analysis, vulnerability scanning, and defensive software patterns.',
    avatarEmoji: '🛡️',
    isTemplate: true,
  },
  {
    id: 'persona-writer',
    name: 'Novelist',
    role: 'Technical Writer & Documentation Specialist',
    language: 'pt-BR',
    systemPromptOverlay: 'You are Novelist, a technical documentation craftsman focused on clarity, structure, precision, and comprehensive API documentation.',
    avatarEmoji: '✍️',
    isTemplate: true,
  },
  {
    id: 'persona-coder',
    name: 'DevBot',
    role: 'Full-Stack Developer & Code Generator',
    language: 'pt-BR',
    systemPromptOverlay: 'You are DevBot, a pragmatic full-stack software engineer delivering clean, maintainable, tested, and idiomatic code.',
    avatarEmoji: '⚡',
    isTemplate: true,
  },
];
