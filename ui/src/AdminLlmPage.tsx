import { useCallback, useEffect, useState } from 'react';
import {
  AdminAuthError,
  adminApi,
  getAdminToken,
  setAdminToken,
  type AdminLlmView,
  type AdminTask,
  type AdminUsage,
  type Tariff,
} from './api';
import { navigate } from './routing';

type TaskDraft = { provider: string; model: string };
type TariffField = keyof Tariff;

const TARIFF_FIELDS: Array<{ field: TariffField; label: string }> = [
  { field: 'audioUsdPerMinute', label: 'US$/min áudio' },
  { field: 'inputUsdPerMTok', label: 'US$/Mtok entrada' },
  { field: 'outputUsdPerMTok', label: 'US$/Mtok saída' },
];

function usd(value: number): string {
  return `US$ ${value.toFixed(value < 1 ? 4 : 2)}`;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function AdminLlmPage() {
  const [view, setView] = useState<AdminLlmView | null>(null);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const [keyRefs, setKeyRefs] = useState<Record<string, string>>({});
  const [summaryEnabled, setSummaryEnabled] = useState(false);
  const [budgetUsd, setBudgetUsd] = useState('');
  const [budgetAction, setBudgetAction] = useState<'warn' | 'block'>('warn');
  const [tariffEdits, setTariffEdits] = useState<Record<string, Tariff>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const applyView = useCallback((next: AdminLlmView) => {
    setView(next);
    setDrafts(Object.fromEntries(next.tasks.map((t) => [t.id, { provider: t.provider, model: t.overridden ? t.model : '' }])));
    setKeyRefs(Object.fromEntries(next.providers.map((p) => [p.id, p.keyRef === p.defaultKeyRef ? '' : p.keyRef])));
    setSummaryEnabled(Boolean(next.tasks.find((t) => t.id === 'session_summary')?.enabled));
    setBudgetUsd(next.budget.monthlyUsd === null ? '' : String(next.budget.monthlyUsd));
    setBudgetAction(next.budget.action);
    setTariffEdits({});
  }, []);

  const handleError = useCallback((e: unknown) => {
    if (e instanceof AdminAuthError) {
      setNeedsToken(true);
      setError(e.message);
    } else {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadUsage = useCallback(
    async (m: string) => {
      try {
        setUsage(await adminApi.usage(m));
      } catch (e) {
        handleError(e);
      }
    },
    [handleError],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      applyView(await adminApi.get());
      setNeedsToken(false);
      await loadUsage(month);
    } catch (e) {
      handleError(e);
    }
  }, [applyView, handleError, loadUsage, month]);

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    if (!view) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const routes: Record<string, { provider: string; model?: string } | null> = {};
      for (const task of view.tasks) {
        const draft = drafts[task.id];
        if (!draft) continue;
        const model = draft.model.trim();
        const unchanged = draft.provider === task.provider && model === (task.overridden ? task.model : '');
        if (unchanged) continue;
        if (!model && task.overridden && draft.provider === task.provider) {
          routes[task.id] = null; // back to the environment defaults
        } else {
          routes[task.id] = model ? { provider: draft.provider, model } : { provider: draft.provider };
        }
      }
      const refs: Record<string, string | null> = {};
      for (const provider of view.providers) {
        const wanted = (keyRefs[provider.id] ?? '').trim();
        const current = provider.keyRef === provider.defaultKeyRef ? '' : provider.keyRef;
        if (wanted !== current) refs[provider.id] = wanted || null;
      }
      const monthly = budgetUsd.trim() === '' ? null : Number(budgetUsd);
      if (monthly !== null && !Number.isFinite(monthly)) throw new Error('Orçamento mensal inválido');
      const tariffs: Record<string, Tariff> = {};
      for (const [key, edit] of Object.entries(tariffEdits)) {
        const base = view.tariffs.entries[key] ?? {};
        const merged: Tariff = {};
        for (const { field } of TARIFF_FIELDS) {
          const value = edit[field] ?? base[field];
          if (value !== undefined) merged[field] = value;
        }
        tariffs[key] = merged;
      }
      const next = await adminApi.update({
        ...(Object.keys(routes).length ? { routes } : {}),
        ...(Object.keys(refs).length ? { keyRefs: refs } : {}),
        ...(summaryEnabled !== Boolean(view.tasks.find((t) => t.id === 'session_summary')?.enabled) ? { summaryEnabled } : {}),
        ...(monthly !== view.budget.monthlyUsd || budgetAction !== view.budget.action
          ? { budget: { monthlyUsd: monthly, action: budgetAction } }
          : {}),
        ...(Object.keys(tariffs).length ? { tariffs } : {}),
      });
      applyView(next);
      await loadUsage(month);
      setNotice('Configuração salva.');
    } catch (e) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (provider: string) => {
    setTestResults((prev) => ({ ...prev, [provider]: 'Testando...' }));
    try {
      const result = await adminApi.test(provider);
      setTestResults((prev) => ({ ...prev, [provider]: result.message }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [provider]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const taskHint = (task: AdminTask, draftProvider: string): string | null => {
    if (task.id !== 'session_summary' && !task.providerOptions.includes('anthropic')) {
      return 'Anthropic não oferece transcrição de áudio (sem STT).';
    }
    if (task.id === 'transcription_realtime' && draftProvider !== 'openai') {
      return 'Somente OpenAI faz transcrição em tempo real.';
    }
    return null;
  };

  return (
    <div className="app app-wide">
      <button className="in-button in-button--ghost in-button--sm back-btn" onClick={() => navigate('/')}>
        ← Voltar
      </button>
      <h1>Provedores de IA e custos</h1>

      {error && <div className="alert">{error}</div>}
      {notice && <div className="admin-notice">{notice}</div>}

      {needsToken && (
        <div className="detail-section">
          <label htmlFor="admin-token">Token de admin</label>
          <input
            id="admin-token"
            type="password"
            className="in-input"
            value={tokenInput}
            placeholder={getAdminToken() ? 'Token salvo nesta aba' : 'ADMIN_TOKEN (ou API_TOKEN)'}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button
            className="in-button in-button--primary"
            onClick={() => {
              setAdminToken(tokenInput.trim());
              setTokenInput('');
              void load();
            }}
          >
            Entrar
          </button>
        </div>
      )}

      {view && (
        <>
          <div className="detail-section">
            <h2>Chaves (somente o nome da variável de ambiente)</h2>
            <p className="in-muted admin-help">
              A chave nunca passa por aqui: ela vem do ambiente do servidor. Aqui você só vê se está configurada.
            </p>
            {view.providers.map((p) => (
              <div key={p.id} className="admin-row">
                <div className="admin-row-main">
                  <strong>{p.label}</strong>
                  <span className={`admin-status ${p.keyConfigured ? 'ok' : 'missing'}`}>
                    {p.keyConfigured ? 'configurada' : 'não configurada'}
                  </span>
                  {!p.capabilities.transcriptionOffline && <span className="in-muted"> · sem STT</span>}
                </div>
                <input
                  aria-label={`Variável da chave ${p.label}`}
                  className="in-input admin-input"
                  value={keyRefs[p.id] ?? ''}
                  placeholder={p.defaultKeyRef}
                  onChange={(e) => setKeyRefs((prev) => ({ ...prev, [p.id]: e.target.value.trim().toUpperCase() }))}
                />
                <button className="in-button in-button--secondary in-button--sm" onClick={() => void handleTest(p.id)}>
                  Testar conexão
                </button>
                {testResults[p.id] && <span className="in-muted admin-test">{testResults[p.id]}</span>}
              </div>
            ))}
          </div>

          <div className="detail-section">
            <h2>Provedor e modelo por tarefa</h2>
            {view.tasks.map((task) => {
              const draft = drafts[task.id] ?? { provider: task.provider, model: '' };
              const hint = taskHint(task, draft.provider);
              return (
                <div key={task.id} className="admin-task">
                  <strong>{task.label}</strong>
                  <div className="admin-row">
                    <select
                      aria-label={`Provedor — ${task.label}`}
                      className="in-input admin-input"
                      value={draft.provider}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [task.id]: { provider: e.target.value, model: '' } }))
                      }
                    >
                      {task.providerOptions.map((id) => (
                        <option key={id} value={id}>
                          {view.providers.find((p) => p.id === id)?.label ?? id}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Modelo — ${task.label}`}
                      className="in-input admin-input"
                      value={draft.model}
                      placeholder={task.defaultModels[draft.provider] ?? task.model}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [task.id]: { ...draft, model: e.target.value } }))}
                    />
                  </div>
                  <span className="in-muted admin-help">
                    Em uso: {task.provider} / {task.model || '—'}
                    {task.keyConfigured ? '' : ' (chave não configurada)'}
                    {hint ? ` · ${hint}` : ''}
                  </span>
                  {task.id === 'session_summary' && (
                    <label className="admin-check">
                      <input
                        type="checkbox"
                        checked={summaryEnabled}
                        onChange={(e) => setSummaryEnabled(e.target.checked)}
                      />{' '}
                      Habilitar resumo (envia a timeline da sessão ao provedor; desligado por padrão)
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="detail-section">
            <h2>Orçamento mensal (estimado)</h2>
            <div className="admin-row">
              <input
                aria-label="Orçamento mensal em dólares"
                className="in-input admin-input"
                inputMode="decimal"
                value={budgetUsd}
                placeholder="sem limite"
                onChange={(e) => setBudgetUsd(e.target.value)}
              />
              <select
                aria-label="Ação ao atingir o orçamento"
                className="in-input admin-input"
                value={budgetAction}
                onChange={(e) => setBudgetAction(e.target.value as 'warn' | 'block')}
              >
                <option value="warn">Só avisar</option>
                <option value="block">Bloquear chamadas pagas</option>
              </select>
            </div>
            <span className={`in-muted admin-help${view.budget.exceeded ? ' admin-over' : ''}`}>
              Gasto estimado neste mês: {usd(view.budget.spentUsd)}
              {view.budget.exceeded ? ' — orçamento atingido' : ''}
            </span>
          </div>

          <button className="in-button in-button--primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar configuração'}
          </button>

          <div className="detail-section">
            <h2>Custo estimado</h2>
            <div className="admin-row">
              <input
                aria-label="Mês (AAAA-MM)"
                className="in-input admin-input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                onBlur={() => void loadUsage(month)}
              />
            </div>
            {usage && (
              <>
                <p>
                  <strong>{usd(usage.totals.costUsd)}</strong> em {usage.totals.calls} chamadas ·{' '}
                  {Math.round(usage.totals.audioSeconds / 60)} min de áudio · {usage.totals.inputTokens + usage.totals.outputTokens} tokens
                  {usage.totals.unpricedCalls > 0 && (
                    <span className="in-muted"> · {usage.totals.unpricedCalls} sem tarifa (fora do total)</span>
                  )}
                </p>
                {usage.sessions.length === 0 ? (
                  <p className="in-muted">Nenhum uso registrado neste mês.</p>
                ) : (
                  <div className="sessions-list admin-sessions">
                    <h2>Por sessão</h2>
                    {usage.sessions.map((s) => (
                      <div key={s.sessionId} className="session-item admin-session-item">
                        <span>{s.name ?? s.sessionId}</span>
                        <span className="in-muted">
                          {Math.round(s.audioSeconds)}s · {usd(s.costUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="detail-section">
            <h2>Tarifas (versão {view.tariffs.version})</h2>
            <p className="in-muted admin-help">
              Valores de referência estimados; confira nas páginas de preço dos provedores e ajuste aqui. Cada alteração gera uma
              nova versão, registrada em cada uso.
            </p>
            {Object.entries(view.tariffs.entries).map(([key, tariff]) => (
              <div key={key} className="admin-row admin-tariff">
                <span className="admin-tariff-key">
                  {key}
                  {tariff.custom && <span className="in-muted"> · editada</span>}
                </span>
                {TARIFF_FIELDS.map(({ field, label }) =>
                  tariff[field] === undefined ? null : (
                    <label key={field} className="admin-tariff-field">
                      {label}
                      <input
                        className="in-input"
                        inputMode="decimal"
                        defaultValue={tariff[field]}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          if (Number.isFinite(value) && value >= 0) {
                            setTariffEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
                          }
                        }}
                      />
                    </label>
                  ),
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
