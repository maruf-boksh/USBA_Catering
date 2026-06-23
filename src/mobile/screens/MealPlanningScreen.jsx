import { useState } from 'react';
import { T } from '../theme';
import { loadMobileMealPlans } from '../../lib/meal-planning-data';

const SLOT_COLORS = {
  Breakfast: { color: T.statusInfo,    bg: T.statusInfoBg    },
  Lunch:     { color: T.statusApproved, bg: T.statusApprovedBg },
  Dinner:    { color: T.statusBoarding, bg: T.statusBoardingBg },
  Snack:     { color: T.statusPending,  bg: T.statusPendingBg  },
};

function MealDetail({ plan, onBack }) {
  const sc = SLOT_COLORS[plan.slot] || SLOT_COLORS.Snack;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{plan.slot} Plan</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{plan.type} · {plan.id}</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 16, marginBottom: 12, boxShadow: T.shadowSm }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: sc.color, background: sc.bg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{plan.slot}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, background: T.bgSubtle, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{plan.type}</span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Menu Items</div>
          {plan.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 8, borderTop: `1px solid ${T.border}` }}>
              <div style={{ width: 6, height: 6, borderRadius: T.radiusFull, background: T.primary, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: T.textPrimary, fontFamily: T.fontBody }}>{item}</span>
            </div>
          ))}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>Calories</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{plan.calories} kcal</span>
          </div>
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 8 }}>Allergens</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {plan.allergens.map((a) => (
                <span key={a} style={{ fontSize: 11, fontWeight: 600, color: T.statusRejected, background: T.statusRejectedBg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{a}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MealPlanningScreen({ nav }) {
  const [selected, setSelected] = useState(null);
  // Live web Meal-Planning config (effective today), mapped to the mobile shape.
  const [plans] = useState(() => loadMobileMealPlans());
  if (selected) return <MealDetail plan={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Meal Planning</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{plans.length} plans active</div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {plans.map((plan) => {
          const sc = SLOT_COLORS[plan.slot] || SLOT_COLORS.Snack;
          return (
            <div
              key={plan.id}
              onClick={() => setSelected(plan)}
              style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{plan.slot} — {plan.type}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{plan.id} · {plan.calories} kcal</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: sc.color, background: sc.bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{plan.slot}</span>
              </div>
              <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{plan.items.slice(0, 3).join(', ')}{plan.items.length > 3 ? ' …' : ''}</div>
              {plan.allergens.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {plan.allergens.map((a) => (
                    <span key={a} style={{ fontSize: 10, color: T.statusRejected, background: T.statusRejectedBg, padding: '2px 6px', borderRadius: T.radiusFull, fontFamily: T.fontBody, fontWeight: 600 }}>{a}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
