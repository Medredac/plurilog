'use client';
import { useState } from 'react';
export default function VideoVerification() {
  const [result, setResult] = useState('Ready');
  const [busy, setBusy] = useState(false);
  async function run(test: string) {
    setBusy(true); setResult('Running ' + test);
    try {
      const response = await fetch('/api/video-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test }) });
      setResult(await response.text());
    } catch (e) { setResult(String(e)); }
    finally { setBusy(false); }
  }
  return <main style={{ padding: 32 }}><h1>Private preview video verification</h1><p>Temporary diagnostic restricted to the owner of the test conversation.</p><div style={{ display: 'flex', gap: 16 }}>{['text', 'stream', 'tools', 'models', 'automatic', 'documented', 'youtube', 'agentic', 'fallback', 'lite', 'upload'].map(test => <button key={test} disabled={busy} onClick={() => run(test)}>{test}</button>)}</div><pre style={{ whiteSpace: 'pre-wrap', marginTop: 32 }}>{result}</pre></main>;
}
