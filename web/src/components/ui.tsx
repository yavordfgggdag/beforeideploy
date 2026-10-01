import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { t, num } from '../i18n';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

export function Button({ kind = 'secondary', size = 'md', icon, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: string }) {
  return (
    <button {...rest} className={`btn btn-${kind} btn-${size} ${rest.className ?? ''}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return <button {...rest} className="icon-btn" aria-label={label} title={label}><Icon name={icon} size={16} /></button>;
}

export function Badge({ tone = 'neutral', children, solid }: { tone?: Tone; children: ReactNode; solid?: boolean }) {
  return <span className={`badge badge-${tone}${solid ? ' badge-solid' : ''}`}>{children}</span>;
}

export function Card({ children, className = '', attention }: { children: ReactNode; className?: string; attention?: Tone }) {
  return <section className={`card ${attention ? 'card-attn card-attn-' + attention : ''} ${className}`}>{children}</section>;
}

export function SectionHeader({ title, trailing, eyebrow }: { title: string; trailing?: ReactNode; eyebrow?: string }) {
  return (
    <div className="section-header">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>
      {trailing}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Segmented meter with an accessible value. Segments are drawn in order; the rest is track. */
export function Meter({ segments, total, label, valueText }: { segments: { value: number; tone: Tone | 'released' }[]; total: number; label: string; valueText: string }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={segments[0]?.value ?? 0} aria-valuetext={valueText}>
      {segments.map((s, i) => (
        <span key={i} className={`meter-seg meter-${s.tone}`} style={{ width: `${Math.max(0, Math.min(100, (s.value / Math.max(1, total)) * 100))}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'sparkle', title, message, action }: { icon?: string; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon"><Icon name={icon} size={22} /></div>
      <h3>{title}</h3>{message && <p>{message}</p>}{action}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return <div className="state" role="status" aria-live="polite"><div className="spinner" aria-hidden /><p>{label ?? t('common.loading')}</p></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon"><Icon name="alert" size={22} /></div>
      <h3>{t('common.errorTitle')}</h3><p>{message}</p>
      {onRetry && <Button onClick={onRetry} icon="arrow">{t('common.retry')}</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; badge?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={value === o.id ? 'tab tab-on' : 'tab'} onClick={() => onChange(o.id)}>
          {o.label}{o.badge ? <span className="tab-badge">{num(o.badge)}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'seg seg-on' : 'seg'} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
