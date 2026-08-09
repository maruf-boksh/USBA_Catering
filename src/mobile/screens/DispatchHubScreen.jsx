import { useState } from 'react';
import { T } from '../theme';
import { DispatchScreen } from './DispatchScreen';
import { DispatchMonScreen } from './DispatchMonScreen';

/**
 * Dispatch — one module, two surfaces.
 *
 * The board (today's dispatches and their loading state) and monitoring (the
 * kitchen → airport cold-chain flow, receiving and the log) were two separate
 * cards that answer the same question at different points in the run. They are
 * one card now, with the two as sub-tabs: the tab strip is the only chrome this
 * adds — each surface renders exactly as before beneath it.
 */
const TABS = [
  { id: 'board',      label: 'Dispatch Board' },
  { id: 'monitoring', label: 'Monitoring' },
];

export function DispatchHubScreen({ nav, initialTab = 'board' }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()}
          style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          ←
        </button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Dispatch</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
            {tab === 'board' ? 'Flight dispatches & loading' : 'Cold chain, receiving & log'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex: 1, padding: '10px 0 8px', background: 'none', border: 'none', borderBottom: `2px solid ${on ? T.primary : 'transparent'}`, cursor: 'pointer', fontFamily: T.fontBody, fontSize: 12, fontWeight: 700, color: on ? T.primary : T.textTertiary }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'board'
          ? <DispatchScreen nav={nav} embedded />
          : <DispatchMonScreen nav={nav} embedded />}
      </div>
    </div>
  );
}
