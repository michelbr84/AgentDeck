/**
 * Plugin installation: local paths and pinned github: sources.
 *
 * Installing a plugin is installing code that runs inside AgentDeck with the
 * user's permissions — dynamic import() has no sandbox. The v1 posture is
 * therefore: github sources REQUIRE a pinned ref (tag or commit; never a
 * moving default branch), callers must pass an explicit confirmation flag,
 * and every install writes a receipt recording exactly what was fetched.
 * Checksums/signatures, registries and sandboxing are deliberately follow-up
 * work, not silently faked here.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureSecureDirectory } from '@agentdeck/security';
import { executeSafeCommand } from '@agentdeck/adapter-sdk';
import { readPluginManifest, AnyPluginManifest } from './plugin-loader.js';

export type PluginSource =
  | { type: 'local'; path: string }
  | { type: 'github'; owner: string; repo: string; ref: string };

export interface InstallReceipt {
  source: string;
  resolved: PluginSource;
  installedAt: string;
  pluginId: string;
  kind: AnyPluginManifest['kind'];
}

export interface InstallResult {
  pluginId: string;
  pluginDir: string;
  kind: AnyPluginManifest['kind'];
  receipt: InstallReceipt;
}

export const INSTALL_RECEIPT_FILENAME = '.agentdeck-install.json';

const GITHUB_SOURCE = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:#(.+))?$/;

export function parsePluginSource(source: string): PluginSource {
  const github = source.match(GITHUB_SOURCE);
  if (github) {
    const [, owner, repo, ref] = github;
    if (!ref || !ref.trim()) {
      throw new Error(
        `github: sources require a pinned ref — use github:${owner}/${repo}#<tag-or-commit>. ` +
          'Installing a moving default branch is refused: what you reviewed is not what you would get.'
      );
    }
    return { type: 'github', owner: owner!, repo: repo!, ref: ref.trim() };
  }
  if (source.startsWith('github:')) {
    throw new Error(`Unrecognized github source "${source}" (expected github:owner/repo#ref)`);
  }
  const localPath = source.startsWith('file:') ? source.slice('file:'.length) : source;
  return { type: 'local', path: path.resolve(localPath) };
}

async function fetchGithubTarball(src: Extract<PluginSource, { type: 'github' }>, destDir: string): Promise<string> {
  const url = `https://codeload.github.com/${src.owner}/${src.repo}/tar.gz/${encodeURIComponent(src.ref)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status}) for ${url} — check that the ref "${src.ref}" exists`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const tarPath = path.join(destDir, 'plugin.tar.gz');
    await fs.writeFile(tarPath, bytes);
    return tarPath;
  } finally {
    clearTimeout(timer);
  }
}

async function extractTarball(tarPath: string, destDir: string): Promise<string> {
  const extractDir = path.join(destDir, 'extracted');
  await fs.mkdir(extractDir, { recursive: true });
  const result = await executeSafeCommand({
    command: 'tar',
    args: ['-xzf', { value: tarPath, type: 'path' }, '-C', { value: extractDir, type: 'path' }],
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`tar extraction failed: ${result.stderr || result.stdout}`);
  }
  // codeload tarballs wrap everything in a single "<repo>-<ref>/" directory.
  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) return path.join(extractDir, dirs[0]!.name);
  return extractDir;
}

export interface InstallOptions {
  pluginsDir: string;
  /** Explicit acknowledgment that plugin code runs with the user's permissions. */
  confirmed: boolean;
}

export async function installPlugin(sourceText: string, options: InstallOptions): Promise<InstallResult> {
  if (!options.confirmed) {
    throw new Error(
      'Installation not confirmed. A plugin runs inside AgentDeck with your permissions — pass the confirmation flag after reviewing its source.'
    );
  }

  const source = parsePluginSource(sourceText);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-plugin-'));
  try {
    let candidateDir: string;
    if (source.type === 'github') {
      const tarPath = await fetchGithubTarball(source, staging);
      candidateDir = await extractTarball(tarPath, staging);
    } else {
      const stat = await fs.stat(source.path).catch(() => null);
      if (!stat?.isDirectory()) {
        throw new Error(`Local plugin source is not a directory: ${source.path}`);
      }
      candidateDir = source.path;
    }

    // Validate BEFORE anything lands in the plugins directory.
    const found = await readPluginManifest(candidateDir);
    const pluginId = found.manifest.id;

    await ensureSecureDirectory(options.pluginsDir);
    const pluginDir = path.join(options.pluginsDir, pluginId);
    const existing = await fs.stat(pluginDir).catch(() => null);
    if (existing) {
      throw new Error(
        `Plugin "${pluginId}" is already installed at ${pluginDir}. Remove it first (agentdeck plugin remove ${pluginId}).`
      );
    }

    await fs.cp(candidateDir, pluginDir, { recursive: true });

    const receipt: InstallReceipt = {
      source: sourceText,
      resolved: source,
      installedAt: new Date().toISOString(),
      pluginId,
      kind: found.kind,
    };
    await fs.writeFile(path.join(pluginDir, INSTALL_RECEIPT_FILENAME), JSON.stringify(receipt, null, 2), 'utf8');

    return { pluginId, pluginDir, kind: found.kind, receipt };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

export async function removePlugin(pluginId: string, pluginsDir: string): Promise<void> {
  const pluginDir = path.join(pluginsDir, pluginId);
  const resolved = path.resolve(pluginDir);
  if (!resolved.startsWith(path.resolve(pluginsDir) + path.sep)) {
    throw new Error(`Refusing to remove a path outside the plugins directory: ${pluginId}`);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) {
    throw new Error(`Plugin "${pluginId}" is not installed in ${pluginsDir}`);
  }
  await fs.rm(resolved, { recursive: true, force: true });
}
