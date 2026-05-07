import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const SETTINGS_VERSION = 1 as const;

export const SettingsSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION).default(SETTINGS_VERSION),
    LLM_BINDING: z.string().default(""),
    LLM_MODEL: z.string().default(""),
    LLM_HOST: z.string().default(""),
    EMBEDDING_BINDING: z.string().default(""),
    EMBEDDING_MODEL: z.string().default(""),
    EMBEDDING_HOST: z.string().default(""),
    SEARCH_PROVIDER: z.string().default(""),
    DISABLE_SSL_VERIFY: z.boolean().default(false),
    AUTO_UPDATE_ENABLED: z.boolean().default(false),
  })
  .passthrough();

export type Settings = z.infer<typeof SettingsSchema>;

const SECRET_KEYS = [
  "LLM_API_KEY",
  "EMBEDDING_API_KEY",
  "SILICONFLOW_API_KEY",
  "DASHSCOPE_API_KEY",
  "COHERE_API_KEY",
  "JINA_API_KEY",
  "GEMINI_API_KEY",
  "SEARCH_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

const SecretsSchema = z.record(z.string(), z.string());
type Secrets = z.infer<typeof SecretsSchema>;

/**
 * Get the file system path to the application's settings JSON file.
 *
 * @returns Absolute path to `settings.json` located in the user's app data directory
 */
function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/**
 * Get the filesystem path for the encrypted secrets file in the application's user data directory.
 *
 * @returns Absolute path to `secrets.bin` inside the Electron `userData` directory.
 */
function secretsPath(): string {
  return path.join(app.getPath("userData"), "secrets.bin");
}

/**
 * Load application settings from the persistent settings file and validate them.
 *
 * If the settings file is missing or its contents cannot be parsed/validated, returns the default settings.
 *
 * @returns The validated Settings object loaded from disk, or the default Settings when missing or invalid.
 */
export function loadSettings(): Settings {
  const file = settingsPath();
  if (!fs.existsSync(file)) return SettingsSchema.parse({});
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return SettingsSchema.parse(raw);
  } catch {
    return SettingsSchema.parse({});
  }
}

/**
 * Persist updated settings by merging the provided partial values with the existing settings and enforcing the current settings version.
 *
 * @param next - Partial settings to merge into the existing settings
 * @returns The merged `Settings` object, validated against the schema and written to disk
 */
export function saveSettings(next: Partial<Settings>): Settings {
  const current = loadSettings();
  const merged = SettingsSchema.parse({ ...current, ...next, version: SETTINGS_VERSION });
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

/**
 * Load and decrypt stored secrets from the application's secrets file.
 *
 * If the secrets file does not exist, Electron's safeStorage encryption is not available,
 * or any read/decrypt/parse error occurs, an empty object is returned.
 *
 * @returns A record mapping secret keys to their string values; an empty object if no secrets are available or on error.
 */
function loadSecrets(): Secrets {
  const file = secretsPath();
  if (!fs.existsSync(file)) return {};
  if (!safeStorage.isEncryptionAvailable()) return {};
  try {
    const ciphertext = fs.readFileSync(file);
    const plaintext = safeStorage.decryptString(ciphertext);
    return SecretsSchema.parse(JSON.parse(plaintext));
  } catch {
    return {};
  }
}

/**
 * Encrypts the provided secrets and writes them to the persistent secrets file.
 *
 * Encrypts `secrets` with Electron's `safeStorage` and writes the resulting ciphertext
 * to the path returned by `secretsPath()`.
 *
 * @param secrets - A record mapping secret keys to their string values
 * @throws Error if safeStorage encryption is not available on the current platform
 */
function persistSecrets(secrets: Secrets): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage encryption is not available on this platform");
  }
  const ciphertext = safeStorage.encryptString(JSON.stringify(secrets));
  fs.writeFileSync(secretsPath(), ciphertext);
}

/**
 * Store or remove a named secret in the encrypted secrets store.
 *
 * @param key - The secret name (one of the defined secret keys, e.g., API key identifiers)
 * @param value - The secret value to store; if an empty string, the secret is removed
 * @throws Error if encrypted secure storage is not available or persistence fails
 */
export function setSecret(key: string, value: string): void {
  if (!(SECRET_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown secret key: ${key}`);
  }
  const secrets = loadSecrets();
  if (value.length === 0) {
    delete secrets[key];
  } else {
    secrets[key] = value;
  }
  persistSecrets(secrets);
}

/**
 * Check whether a stored secret exists for the given key.
 *
 * @param key - The secret key name to check (should be one of the defined secret keys)
 * @returns `true` if a secret is stored for `key`, `false` otherwise
 */
export function hasSecret(key: string): boolean {
  return key in loadSecrets();
}

/**
 * Provides the canonical list of secret key names used by the application.
 *
 * @returns A readonly array of secret key identifiers.
 */
export function listSecretKeys(): readonly string[] {
  return SECRET_KEYS;
}

/**
 * Produce a map of settings formatted for use as environment variables.
 *
 * Omits the `version` and `AUTO_UPDATE_ENABLED` keys. Includes string
 * settings only when non-empty. Booleans are encoded by PRESENCE: `true`
 * emits `"1"`, `false` omits the key entirely. The Python sidecar treats
 * `if os.environ.get("DISABLE_SSL_VERIFY"):` as truthy for ANY non-empty
 * string (including `"0"`), so we cannot use `"0"` for false.
 *
 * @returns A record mapping setting keys to string values suitable for
 * environment consumption.
 */
export function loadSettingsEnv(): Record<string, string> {
  const settings = loadSettings();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k === "version" || k === "AUTO_UPDATE_ENABLED") continue;
    if (typeof v === "string" && v.length > 0) out[k] = v;
    if (typeof v === "boolean" && v) out[k] = "1";
  }
  return out;
}

/**
 * Provide a shallow copy of stored secrets for use as environment variables.
 *
 * @returns A plain object mapping secret key names to their string values
 */
export function loadSecretsEnv(): Record<string, string> {
  return { ...loadSecrets() };
}
