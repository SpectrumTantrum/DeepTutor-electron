'use client'

import { useEffect, useState } from 'react'
import { getElectronBridge } from '@/lib/electron-bridge'

interface FormState {
  LLM_BINDING: string
  LLM_MODEL: string
  LLM_HOST: string
  EMBEDDING_BINDING: string
  EMBEDDING_MODEL: string
  EMBEDDING_HOST: string
  SEARCH_PROVIDER: string
  DISABLE_SSL_VERIFY: boolean
  AUTO_UPDATE_ENABLED: boolean
}

const DEFAULT_FORM: FormState = {
  LLM_BINDING: '',
  LLM_MODEL: '',
  LLM_HOST: '',
  EMBEDDING_BINDING: '',
  EMBEDDING_MODEL: '',
  EMBEDDING_HOST: '',
  SEARCH_PROVIDER: '',
  DISABLE_SSL_VERIFY: false,
  AUTO_UPDATE_ENABLED: false,
}

export default function ElectronSettingsPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({})
  const [secretKeys, setSecretKeys] = useState<readonly string[]>([])
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<string>('')
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const bridge = getElectronBridge()
    if (!bridge) {
      setUnavailable(true)
      return
    }
    void bridge.getSettings().then(data => {
      setForm({ ...DEFAULT_FORM, ...(data.settings as Partial<FormState>) })
      setSecretStatus(data.secretStatus)
      setSecretKeys(data.secretKeys)
    })
  }, [])

  if (unavailable) {
    return (
      <main style={{ padding: 32, fontFamily: 'system-ui' }}>
        <h1>Settings unavailable</h1>
        <p>
          This page only renders inside the DeepTutor desktop app. The browser build does not have
          access to local secret storage.
        </p>
      </main>
    )
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const onSave = async () => {
    const bridge = getElectronBridge()
    if (!bridge) return
    setStatus('Saving…')
    try {
      await bridge.saveSettings(form as unknown as Record<string, unknown>)
      for (const [key, value] of Object.entries(secretInputs)) {
        if (value && value.length > 0) {
          await bridge.setSecret(key, value)
        }
      }
      setSecretInputs({})
      const refreshed = await bridge.getSettings()
      setSecretStatus(refreshed.secretStatus)
      setStatus('Saved. Restart the app for changes to take effect.')
    } catch (err) {
      setStatus(`Save failed: ${String(err)}`)
    }
  }

  const onRestart = async () => {
    const bridge = getElectronBridge()
    if (!bridge) return
    await bridge.restartSidecar()
    setStatus('Sidecar stopped. Quit and relaunch DeepTutor to apply.')
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif",
        color: '#e6e8ec',
        background: '#0b0d12',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ marginTop: 0, fontSize: 22 }}>DeepTutor Settings</h1>

      <Section title="Language Model">
        <Field
          label="Binding"
          value={form.LLM_BINDING}
          onChange={v => update('LLM_BINDING', v)}
          placeholder="openai"
        />
        <Field
          label="Model"
          value={form.LLM_MODEL}
          onChange={v => update('LLM_MODEL', v)}
          placeholder="gpt-4o-mini"
        />
        <Field
          label="Host"
          value={form.LLM_HOST}
          onChange={v => update('LLM_HOST', v)}
          placeholder="https://api.openai.com/v1"
        />
      </Section>

      <Section title="Embedding Model">
        <Field
          label="Binding"
          value={form.EMBEDDING_BINDING}
          onChange={v => update('EMBEDDING_BINDING', v)}
          placeholder="openai"
        />
        <Field
          label="Model"
          value={form.EMBEDDING_MODEL}
          onChange={v => update('EMBEDDING_MODEL', v)}
          placeholder="text-embedding-3-small"
        />
        <Field
          label="Host"
          value={form.EMBEDDING_HOST}
          onChange={v => update('EMBEDDING_HOST', v)}
          placeholder="https://api.openai.com/v1"
        />
      </Section>

      <Section title="Search">
        <Field
          label="Provider"
          value={form.SEARCH_PROVIDER}
          onChange={v => update('SEARCH_PROVIDER', v)}
          placeholder="(optional)"
        />
      </Section>

      <Section title="API Keys">
        <p style={{ opacity: 0.6, fontSize: 12, marginTop: 0 }}>
          Stored encrypted via macOS Keychain. Existing keys are not displayed back to the renderer;
          leave blank to keep the current value.
        </p>
        {secretKeys.map(key => (
          <div key={key} style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
              {key}
              {secretStatus[key] ? ' (set)' : ' (not set)'}
            </label>
            <input
              type="password"
              value={secretInputs[key] ?? ''}
              placeholder={secretStatus[key] ? '•••••••• (hidden)' : ''}
              onChange={e => setSecretInputs(prev => ({ ...prev, [key]: e.target.value }))}
              style={inputStyle}
            />
          </div>
        ))}
      </Section>

      <Section title="Updates">
        <Toggle
          label="Automatically download and install updates"
          value={form.AUTO_UPDATE_ENABLED}
          onChange={v => update('AUTO_UPDATE_ENABLED', v)}
        />
      </Section>

      <Section title="Advanced">
        <Toggle
          label="Disable SSL verification (not recommended)"
          value={form.DISABLE_SSL_VERIFY}
          onChange={v => update('DISABLE_SSL_VERIFY', v)}
        />
      </Section>

      <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
        <button onClick={onSave} style={primaryButtonStyle}>
          Save
        </button>
        <button onClick={onRestart} style={secondaryButtonStyle}>
          Restart Backend
        </button>
        <span style={{ alignSelf: 'center', opacity: 0.7, fontSize: 12 }}>{status}</span>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, opacity: 0.8, margin: '0 0 8px' }}>{title}</h2>
      <div
        style={{
          background: '#11141a',
          borderRadius: 8,
          padding: 12,
          border: '1px solid #1f242e',
        }}
      >
        {children}
      </div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  )
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid #2a2f3a',
  background: '#0b0d12',
  color: '#e6e8ec',
  fontFamily: 'inherit',
  fontSize: 13,
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: '#3b82f6',
  color: 'white',
  fontWeight: 600,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: 'transparent',
  color: '#e6e8ec',
  cursor: 'pointer',
}
