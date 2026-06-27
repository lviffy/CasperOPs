'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Key, Shield, Package, Zap, Plus, AlertCircle, CheckCircle2,
  ChevronRight, Upload, Cpu, Clock, RefreshCw, Copy, ExternalLink,
  BarChart2, Info, Trash2, ArrowUpRight,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AssociatedKey {
  account_hash: string;
  weight: number;
}

interface DelegatedKey {
  delegate_key: string;
  weight: number;
  daily_limit_cspr: string | null;
  expires_at: string | null;
  deploy_hash: string;
  created_at: string;
}

interface WasmSuggestion {
  level: 'success' | 'warning' | 'info';
  message: string;
}

interface GasProfile {
  wasmSizeKb: number;
  callInstructions: number;
  estimatedPaymentCspr: string;
  estimatedPaymentMotes: string;
  suggestions: WasmSuggestion[];
  breakdown: { baseCspr: number; sizeCostCspr: number; complexityCspr: number };
  memoryPageCount?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const truncate = (s: string, n = 16) =>
  s.length > n ? `${s.slice(0, n)}…${s.slice(-6)}` : s;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded hover:bg-white/10 transition-colors"
      title="Copy"
    >
      {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} className="text-gray-400" />}
    </button>
  );
}

function StatusBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    warning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    info: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    error: 'bg-red-500/20 text-red-300 border-red-500/30',
  };
  const Icon = level === 'success' ? CheckCircle2 : level === 'warning' ? AlertCircle : Info;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border ${map[level] || map.info}`}>
      <Icon size={11} />
      {level}
    </span>
  );
}

// ─── Tab: Key Weights ─────────────────────────────────────────────────────────

function KeyWeightsTab() {
  const [publicKey, setPublicKey] = useState('');
  const [keys, setKeys] = useState<AssociatedKey[]>([]);
  const [actionThreshold, setActionThreshold] = useState(1);
  const [deployThreshold, setDeployThreshold] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  // New key form
  const [newKeyHash, setNewKeyHash] = useState('');
  const [newKeyWeight, setNewKeyWeight] = useState(1);

  const fetchKeys = async () => {
    if (!publicKey.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/account/${publicKey.trim()}/keys`);
      const data = await r.json();
      if (data.ok) {
        setKeys(data.associatedKeys || []);
        setActionThreshold(data.actionThreshold || 1);
        setDeployThreshold(data.deploymentThreshold || 1);
      } else setError(data.error || 'Failed to load keys');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const addKey = () => {
    if (!newKeyHash.trim()) return;
    setKeys(prev => [...prev, { account_hash: newKeyHash.trim(), weight: newKeyWeight }]);
    setNewKeyHash(''); setNewKeyWeight(1);
  };

  const removeKey = (idx: number) => setKeys(prev => prev.filter((_, i) => i !== idx));

  const submitUpdate = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch('/api/account/update-weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_key: publicKey.trim(), keys, action_threshold: actionThreshold, deployment_threshold: deployThreshold }),
      });
      const data = await r.json();
      if (data.ok) setResult(data);
      else setError(data.error || 'Update failed');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Key size={18} className="text-violet-400" /> Fetch Account Keys
        </h3>
        <div className="flex gap-3">
          <input
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/60 transition-colors font-mono"
            placeholder="0166b7d9e17a3..." value={publicKey}
            onChange={e => setPublicKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchKeys()}
          />
          <button onClick={fetchKeys} disabled={loading}
            className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-xl text-sm font-medium text-white transition-all flex items-center gap-2">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <ChevronRight size={14} />}
            Fetch
          </button>
        </div>
      </div>

      {keys.length > 0 && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Shield size={18} className="text-emerald-400" /> Associated Keys
          </h3>
          <div className="space-y-2">
            {keys.map((k, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/8 group">
                <div className="flex-1 font-mono text-xs text-gray-300">{truncate(k.account_hash, 24)}</div>
                <CopyButton text={k.account_hash} />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">weight</span>
                  <input
                    type="number" min={1} max={255} value={k.weight}
                    onChange={e => setKeys(prev => prev.map((kk, ii) => ii === i ? { ...kk, weight: Number(e.target.value) } : kk))}
                    className="w-16 bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-violet-500/60"
                  />
                </div>
                <button onClick={() => removeKey(i)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-red-400 text-gray-500 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Add new key */}
          <div className="flex gap-3 pt-2">
            <input
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/60 font-mono"
              placeholder="account-hash-... or public key" value={newKeyHash}
              onChange={e => setNewKeyHash(e.target.value)}
            />
            <input
              type="number" min={1} max={255} value={newKeyWeight}
              onChange={e => setNewKeyWeight(Number(e.target.value))}
              className="w-20 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white text-center focus:outline-none focus:border-violet-500/60"
              placeholder="wt"
            />
            <button onClick={addKey} className="px-4 py-2.5 bg-white/10 hover:bg-white/15 rounded-xl text-sm font-medium text-white transition-all flex items-center gap-2">
              <Plus size={14} /> Add
            </button>
          </div>

          {/* Thresholds */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            {[
              { label: 'Action Threshold', value: actionThreshold, set: setActionThreshold },
              { label: 'Deployment Threshold', value: deployThreshold, set: setDeployThreshold },
            ].map(({ label, value, set }) => (
              <div key={label} className="space-y-2">
                <label className="text-xs text-gray-400">{label}</label>
                <input type="number" min={1} max={255} value={value} onChange={e => set(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60" />
              </div>
            ))}
          </div>

          <button onClick={submitUpdate} disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2 mt-2">
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <Key size={15} />}
            Prepare Weight Update Deploy
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {result && (
        <DeployResultCard result={result} />
      )}
    </div>
  );
}

// ─── Tab: Delegated Keys ──────────────────────────────────────────────────────

function DelegatedKeysTab() {
  const [publicKey, setPublicKey] = useState('');
  const [delegateKey, setDelegateKey] = useState('');
  const [weight, setWeight] = useState(1);
  const [dailyLimit, setDailyLimit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const submit = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const body: any = { public_key: publicKey.trim(), delegate_key: delegateKey.trim(), weight };
      if (dailyLimit) body.daily_limit_motes = String(Math.round(Number(dailyLimit) * 1e9));
      if (expiresAt) body.expires_at = new Date(expiresAt).toISOString();
      const r = await fetch('/api/account/delegated-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.ok) setResult(data);
      else setError(data.error || 'Failed');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Clock size={18} className="text-amber-400" /> Add Delegated Sub-Key
        </h3>
        <p className="text-sm text-gray-400">
          Grant an AI agent a time-bound associated key with partial signing weight and optional daily CSPR spending cap.
        </p>
        <div className="grid grid-cols-1 gap-4">
          {[
            { label: 'Owner Public Key', value: publicKey, set: setPublicKey, ph: '0166b7d...', mono: true },
            { label: 'Delegate Public Key (Agent Key)', value: delegateKey, set: setDelegateKey, ph: '019abc1...', mono: true },
          ].map(({ label, value, set, ph, mono }) => (
            <div key={label} className="space-y-1.5">
              <label className="text-xs text-gray-400">{label}</label>
              <input value={value} onChange={e => set(e.target.value)}
                className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/60 ${mono ? 'font-mono' : ''}`}
                placeholder={ph} />
            </div>
          ))}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Weight (1–254)</label>
              <input type="number" min={1} max={254} value={weight} onChange={e => setWeight(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/60" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Daily Limit (CSPR)</label>
              <input type="number" min={0} value={dailyLimit} onChange={e => setDailyLimit(e.target.value)}
                placeholder="e.g. 100"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/60" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Expires At</label>
              <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/60" />
            </div>
          </div>
        </div>
        <button onClick={submit} disabled={loading || !publicKey || !delegateKey}
          className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2">
          {loading ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />}
          Prepare Delegated Key Deploy
        </button>
      </div>
      {error && <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}
      {result && <DeployResultCard result={result} />}
    </div>
  );
}

// ─── Tab: Contract Upgrader ───────────────────────────────────────────────────

function ContractUpgraderTab() {
  const [packageHash, setPackageHash] = useState('');
  const [wasmHex, setWasmHex] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const buf = ev.target?.result as ArrayBuffer;
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      setWasmHex(hex);
    };
    reader.readAsArrayBuffer(file);
  };

  const submit = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch('/api/contract/upgrade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_hash: packageHash.trim(), wasm_hex: wasmHex }),
      });
      const data = await r.json();
      if (data.ok) setResult(data);
      else setError(data.error || 'Upgrade failed');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Package size={18} className="text-sky-400" /> Upgrade Contract Package
        </h3>
        <p className="text-sm text-gray-400">
          Deploy new WASM to an existing Casper contract package — preserving all stored data and named keys.
        </p>
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Contract Package Hash</label>
          <input value={packageHash} onChange={e => setPackageHash(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-sky-500/60 font-mono"
            placeholder="hash-abc123... or raw 64-char hex" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">WASM Binary</label>
          <div
            onClick={() => fileRef.current?.click()}
            className="relative flex flex-col items-center justify-center h-36 border-2 border-dashed border-white/15 rounded-2xl cursor-pointer hover:border-sky-500/40 hover:bg-sky-500/5 transition-all group"
          >
            <input type="file" accept=".wasm" ref={fileRef} onChange={handleFile} className="hidden" />
            {fileName ? (
              <>
                <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
                <p className="text-sm text-white font-medium">{fileName}</p>
                <p className="text-xs text-gray-500 mt-1">{Math.round(wasmHex.length / 2)} bytes loaded</p>
              </>
            ) : (
              <>
                <Upload size={28} className="text-gray-500 group-hover:text-sky-400 mb-2 transition-colors" />
                <p className="text-sm text-gray-400">Click to upload <span className="text-white">.wasm</span> file</p>
              </>
            )}
          </div>
          {!fileName && (
            <textarea value={wasmHex} onChange={e => setWasmHex(e.target.value)}
              rows={3} placeholder="Or paste hex-encoded WASM..."
              className="w-full mt-2 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-gray-300 placeholder-gray-600 font-mono focus:outline-none focus:border-sky-500/60 resize-none" />
          )}
        </div>
        <button onClick={submit} disabled={loading || !packageHash || !wasmHex}
          className="w-full py-3 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2">
          {loading ? <RefreshCw size={15} className="animate-spin" /> : <ArrowUpRight size={15} />}
          Prepare Upgrade Deploy
        </button>
      </div>
      {error && <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}
      {result && <DeployResultCard result={result} />}
    </div>
  );
}

// ─── Tab: WASM Gas Profiler ───────────────────────────────────────────────────

function WasmProfilerTab() {
  const [wasmHex, setWasmHex] = useState('');
  const [fileName, setFileName] = useState('');
  const [entryPoint, setEntryPoint] = useState('call');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<GasProfile | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const buf = ev.target?.result as ArrayBuffer;
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      setWasmHex(hex);
    };
    reader.readAsArrayBuffer(file);
  };

  const submit = async () => {
    setLoading(true); setError(''); setProfile(null);
    try {
      const r = await fetch('/api/wasm/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wasm_hex: wasmHex, entry_point: entryPoint }),
      });
      const data = await r.json();
      if (data.ok) setProfile(data);
      else setError(data.error || 'Profiling failed');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Cpu size={18} className="text-fuchsia-400" /> WASM Gas Profiler
        </h3>
        <p className="text-sm text-gray-400">
          Statically analyze compiled Casper WASM binaries to estimate gas cost and surface optimization opportunities.
        </p>
        <div
          onClick={() => fileRef.current?.click()}
          className="relative flex flex-col items-center justify-center h-36 border-2 border-dashed border-white/15 rounded-2xl cursor-pointer hover:border-fuchsia-500/40 hover:bg-fuchsia-500/5 transition-all group"
        >
          <input type="file" accept=".wasm" ref={fileRef} onChange={handleFile} className="hidden" />
          {fileName ? (
            <>
              <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
              <p className="text-sm text-white font-medium">{fileName}</p>
              <p className="text-xs text-gray-500 mt-1">{Math.round(wasmHex.length / 2 / 1024).toFixed(1)} kB loaded</p>
            </>
          ) : (
            <>
              <Upload size={28} className="text-gray-500 group-hover:text-fuchsia-400 mb-2 transition-colors" />
              <p className="text-sm text-gray-400">Upload <span className="text-white">.wasm</span> file to profile</p>
            </>
          )}
        </div>
        {!fileName && (
          <textarea value={wasmHex} onChange={e => setWasmHex(e.target.value)} rows={3}
            placeholder="Or paste WASM hex..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-gray-300 placeholder-gray-600 font-mono focus:outline-none focus:border-fuchsia-500/60 resize-none" />
        )}
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Entry Point (optional)</label>
          <input value={entryPoint} onChange={e => setEntryPoint(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-fuchsia-500/60"
            placeholder="call" />
        </div>
        <button onClick={submit} disabled={loading || !wasmHex}
          className="w-full py-3 bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2">
          {loading ? <RefreshCw size={15} className="animate-spin" /> : <Zap size={15} />}
          Profile Gas Cost
        </button>
      </div>

      {error && <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-300"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}

      {profile && (
        <div className="space-y-4">
          {/* Gas estimate hero */}
          <div className="glass-card rounded-2xl p-6">
            <h4 className="text-sm text-gray-400 mb-4">Gas Estimate</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Estimated Payment', value: `${profile.estimatedPaymentCspr} CSPR`, accent: 'text-fuchsia-300' },
                { label: 'Binary Size', value: `${profile.wasmSizeKb} kB`, accent: 'text-sky-300' },
                { label: 'Call Instructions', value: profile.callInstructions.toLocaleString(), accent: 'text-amber-300' },
                { label: 'Memory Pages', value: profile.memoryPageCount || '—', accent: 'text-emerald-300' },
              ].map(({ label, value, accent }) => (
                <div key={label} className="bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-xl font-bold ${accent}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="glass-card rounded-2xl p-6">
            <h4 className="text-sm text-gray-400 mb-3 flex items-center gap-2"><BarChart2 size={14} /> Cost Breakdown</h4>
            {[
              { label: 'Base activation cost', cspr: profile.breakdown.baseCspr, color: 'bg-violet-500' },
              { label: 'Binary size cost', cspr: profile.breakdown.sizeCostCspr, color: 'bg-sky-500' },
              { label: 'Complexity overhead', cspr: profile.breakdown.complexityCspr, color: 'bg-amber-500' },
            ].map(({ label, cspr, color }) => {
              const total = profile.breakdown.baseCspr + profile.breakdown.sizeCostCspr + profile.breakdown.complexityCspr;
              const pct = total > 0 ? (cspr / total) * 100 : 0;
              return (
                <div key={label} className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-white font-mono">{cspr} CSPR</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Suggestions */}
          <div className="glass-card rounded-2xl p-6 space-y-3">
            <h4 className="text-sm text-gray-400">Optimization Suggestions</h4>
            {profile.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/5">
                <StatusBadge level={s.level} />
                <span className="text-sm text-gray-300">{s.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Deploy Result Card ───────────────────────────────────────────────────────

function DeployResultCard({ result }: { result: any }) {
  return (
    <div className="glass-card rounded-2xl p-6 border border-emerald-500/20 space-y-3">
      <div className="flex items-center gap-2 text-emerald-400">
        <CheckCircle2 size={18} />
        <span className="font-semibold">Deploy Prepared Successfully</span>
      </div>
      <p className="text-sm text-gray-300">{result.message}</p>
      {result.explorerUrl && (
        <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors">
          View on CSPR.live <ExternalLink size={11} />
        </a>
      )}
      <div className="mt-2 p-3 bg-black/30 rounded-xl">
        <p className="text-xs text-gray-500 mb-1.5 font-mono">Deploy JSON (sign with CSPR.click)</p>
        <pre className="text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {JSON.stringify(result.deployJson, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'keys', label: 'Key Weights', icon: Key, color: 'violet' },
  { id: 'delegated', label: 'Delegated Keys', icon: Clock, color: 'amber' },
  { id: 'upgrade', label: 'Contract Upgrader', icon: Package, color: 'sky' },
  { id: 'profiler', label: 'Gas Profiler', icon: Cpu, color: 'fuchsia' },
] as const;

type TabId = typeof TABS[number]['id'];

const tabColorMap: Record<string, string> = {
  violet: 'border-violet-500 text-violet-400',
  amber: 'border-amber-500 text-amber-400',
  sky: 'border-sky-500 text-sky-400',
  fuchsia: 'border-fuchsia-500 text-fuchsia-400',
};

export default function AccountManagerPage() {
  const [activeTab, setActiveTab] = useState<TabId>('keys');

  return (
    <>
      <style>{`
        .glass-card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          backdrop-filter: blur(12px);
        }
        body { background: #09090f; }
      `}</style>

      <div className="min-h-screen bg-gradient-to-br from-[#09090f] via-[#0d0d1a] to-[#09090f] text-white">
        {/* Header */}
        <div className="border-b border-white/8 bg-black/20 backdrop-blur-xl sticky top-0 z-20">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-300 via-fuchsia-300 to-purple-300 bg-clip-text text-transparent">
                  Casper Account Manager
                </h1>
                <p className="text-sm text-gray-400 mt-0.5">Native threshold governance, delegated keys & contract upgrades</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400 font-medium">Casper Testnet</span>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 mb-8">
            {[
              { icon: Shield, label: 'Threshold Governance', color: 'text-violet-400' },
              { icon: Clock, label: 'Time-Bound Sub-Keys', color: 'text-amber-400' },
              { icon: Package, label: 'Contract Upgradeability', color: 'text-sky-400' },
              { icon: Zap, label: 'Gas Optimization', color: 'text-fuchsia-400' },
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white/5 border border-white/8 ${color}`}>
                <Icon size={12} /> {label}
              </div>
            ))}
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 p-1 bg-white/5 border border-white/8 rounded-2xl mb-8">
            {TABS.map(({ id, label, icon: Icon, color }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === id
                    ? `bg-white/10 border ${tabColorMap[color]}`
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'keys' && <KeyWeightsTab />}
          {activeTab === 'delegated' && <DelegatedKeysTab />}
          {activeTab === 'upgrade' && <ContractUpgraderTab />}
          {activeTab === 'profiler' && <WasmProfilerTab />}
        </div>
      </div>
    </>
  );
}
