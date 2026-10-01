import { useEffect, useMemo, useState } from 'react';
import { Button, Card, PageHeader, Segmented, Field, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { t, num } from '../i18n';
import { CATALOG } from '../demo/data';

// The brief follows schema bid.site-brief/1 (docs/PLAN-UNIFIED-BG.md §7.3). Both modes edit the same document.
type SiteType = 'company' | 'landing' | 'portfolio' | 'blog' | 'catalog' | 'booking' | 'event' | 'cause';
interface Brief {
  mode: 'quick' | 'detailed';
  business: { name: string; description: string; goal: string; languages: string[]; primaryAction: string };
  type: SiteType | null; pages: string[];
  design: { style: string; palette: string; density: string; motion: 'none' | 'subtle' | 'lively' };
  content: { tone: string; services: string; contact: string };
  features: string[];
}
const EMPTY: Brief = { mode: 'quick', business: { name: '', description: '', goal: '', languages: ['bg'], primaryAction: '' }, type: null, pages: [],
  design: { style: '', palette: '', density: 'balanced', motion: 'subtle' }, content: { tone: 'friendly', services: '', contact: '' }, features: ['contactForm'] };

const TYPES: { id: SiteType; icon: string; pages: string[] }[] = [
  { id: 'company', icon: 'sites', pages: ['home', 'services', 'about', 'contact'] }, { id: 'landing', icon: 'rocket', pages: ['home'] },
  { id: 'portfolio', icon: 'code', pages: ['home', 'work', 'about', 'contact'] }, { id: 'blog', icon: 'activity', pages: ['home', 'posts', 'about'] },
  { id: 'catalog', icon: 'archive', pages: ['home', 'products', 'order', 'contact'] }, { id: 'booking', icon: 'clock', pages: ['home', 'services', 'prices', 'booking'] },
  { id: 'event', icon: 'sparkle', pages: ['home', 'schedule', 'tickets'] }, { id: 'cause', icon: 'shield', pages: ['home', 'mission', 'donate'] },
];
const STYLES = [{ id: 'calm', sw: ['#F6F2EC', '#2A1D14', '#B4532A'] }, { id: 'bold', sw: ['#0B0F1A', '#EEF0F7', '#5B8CFF'] }, { id: 'fresh', sw: ['#F7FAF6', '#15251A', '#15803D'] }, { id: 'elegant', sw: ['#FBF8F3', '#3B2F2A', '#A47148'] }];
// feature availability in v1 (docs §4.2); "soon" never looks like a ready capability
const FEATURES: { id: string; types?: SiteType[]; v1: boolean; external?: boolean }[] = [
  { id: 'contactForm', v1: true }, { id: 'booking', types: ['booking', 'company'], v1: true, external: true }, { id: 'catalogOrder', types: ['catalog'], v1: true },
  { id: 'newsletter', v1: true, external: true }, { id: 'analytics', v1: true, external: true }, { id: 'multilang', v1: true },
  { id: 'payments', types: ['catalog'], v1: false }, { id: 'accounts', v1: false },
];
const STEPS = ['business', 'type', 'visual', 'content', 'features', 'manage', 'review'] as const;
type Step = (typeof STEPS)[number];
const KEY = 'bid.createSite.draft';

/** Credit estimate range from §7.5 (Sonnet), scaled by page count; shown before any paid generation. */
export function estimate(b: Brief) { const p = Math.max(1, b.pages.length); return { min: Math.round(14_000 + p * 2_000), max: Math.round(24_000 + p * 4_500) }; }

export function CreateSite() {
  const [b, setB] = useState<Brief>(() => { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return EMPTY; } });
  const [step, setStep] = useState<Step>('business');
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage unavailable */ } }, [b]);
  const set = (patch: Partial<Brief>) => setB((x) => ({ ...x, ...patch }));
  const visibleSteps = b.mode === 'quick' ? STEPS.filter((s) => s !== 'content' && s !== 'manage') : [...STEPS];
  const idx = visibleSteps.indexOf(step as never);
  const est = useMemo(() => estimate(b), [b]);
  const canNext = step === 'business' ? b.business.name.trim().length > 1 && b.business.description.trim().length > 9 : step === 'type' ? !!b.type : true;
  const suggest = () => { // "Предложи ми": deterministic local suggestion in the prototype; the real flow asks site_brief_assist (AI)
    if (step === 'type' && !b.type) set({ type: 'company', pages: TYPES[0].pages });
    if (step === 'visual') set({ design: { ...b.design, style: 'calm', palette: 'calm' } });
  };

  return (
    <div className="page create">
      <PageHeader title={t('create.title')} subtitle={t('create.subtitle')}
        actions={<Segmented label={t('create.mode')} value={b.mode} onChange={(m) => set({ mode: m })} options={[{ id: 'quick', label: t('create.quick') }, { id: 'detailed', label: t('create.detailed') }]} />} />
      <ol className="stepper" aria-label={t('create.steps')}>
        {visibleSteps.map((s, i) => (
          <li key={s} className={s === step ? 'on' : i < idx ? 'done' : ''}><button onClick={() => setStep(s)} aria-current={s === step ? 'step' : undefined}><span className="dot">{i < idx ? <Icon name="check" size={12} /> : i + 1}</span>{t('create.step.' + s)}</button></li>
        ))}
      </ol>
      <div className="create-grid">
        <Card className="create-main">
          {step === 'business' && (<>
            <h2>{t('create.step.business')}</h2>
            <Field label={t('create.f.name')}><input value={b.business.name} onChange={(e) => set({ business: { ...b.business, name: e.target.value } })} placeholder={t('create.f.namePh')} /></Field>
            <Field label={t('create.f.description')} hint={t('create.f.descriptionHint')}><textarea value={b.business.description} onChange={(e) => set({ business: { ...b.business, description: e.target.value } })} rows={3} /></Field>
            <Field label={t('create.f.goal')}>
              <div className="choices">{['leads', 'bookings', 'sales', 'showcase', 'info'].map((g) => <button key={g} className={b.business.goal === g ? 'choice on' : 'choice'} onClick={() => set({ business: { ...b.business, goal: g } })}>{t('goal.' + g)}</button>)}</div>
            </Field>
          </>)}
          {step === 'type' && (<>
            <h2>{t('create.step.type')}</h2>
            <div className="type-grid">{TYPES.map((x) => (
              <button key={x.id} className={b.type === x.id ? 'type on' : 'type'} onClick={() => set({ type: x.id, pages: x.pages })} aria-pressed={b.type === x.id}>
                <Icon name={x.icon} size={22} /><strong>{t('type.' + x.id)}</strong><span>{t('type.' + x.id + '.d')}</span>
              </button>))}
            </div>
            {b.type && <Field label={t('create.f.pages')} hint={t('create.f.pagesHint')}><div className="chips">{b.pages.map((p) => <span key={p} className="chip">{t('page.' + p)}<button aria-label={t('create.removePage', { page: t('page.' + p) })} onClick={() => set({ pages: b.pages.filter((x) => x !== p) })}><Icon name="x" size={12} /></button></span>)}</div></Field>}
          </>)}
          {step === 'visual' && (<>
            <h2>{t('create.step.visual')}</h2>
            <div className="style-grid">{STYLES.map((s) => (
              <button key={s.id} className={b.design.style === s.id ? 'style on' : 'style'} onClick={() => set({ design: { ...b.design, style: s.id, palette: s.id } })} aria-pressed={b.design.style === s.id}>
                <span className="preview" style={{ background: s.sw[0], color: s.sw[1] }}><span className="pv-title">Aa</span><span className="pv-bar" style={{ background: s.sw[2] }} /><span className="pv-line" /><span className="pv-line short" /></span>
                <strong>{t('style.' + s.id)}</strong>
              </button>))}
            </div>
            <Field label={t('create.f.motion')}><Segmented label={t('create.f.motion')} value={b.design.motion} onChange={(m) => set({ design: { ...b.design, motion: m } })} options={[{ id: 'none', label: t('motion.none') }, { id: 'subtle', label: t('motion.subtle') }, { id: 'lively', label: t('motion.lively') }]} /></Field>
          </>)}
          {step === 'content' && (<>
            <h2>{t('create.step.content')}</h2>
            <Field label={t('create.f.services')} hint={t('create.f.servicesHint')}><textarea rows={4} value={b.content.services} onChange={(e) => set({ content: { ...b.content, services: e.target.value } })} /></Field>
            <Field label={t('create.f.contact')}><input value={b.content.contact} onChange={(e) => set({ content: { ...b.content, contact: e.target.value } })} placeholder="hello@example.com · +359 …" /></Field>
            <p className="note"><Icon name="shield" size={14} /> {t('create.noFake')}</p>
          </>)}
          {step === 'features' && (<>
            <h2>{t('create.step.features')}</h2>
            <ul className="feature-list">{FEATURES.filter((f) => !f.types || (b.type && f.types.includes(b.type))).map((f) => (
              <li key={f.id}>
                <label className={f.v1 ? '' : 'disabled'}>
                  <input type="checkbox" disabled={!f.v1} checked={b.features.includes(f.id)} onChange={(e) => set({ features: e.target.checked ? [...b.features, f.id] : b.features.filter((x) => x !== f.id) })} />
                  <span><strong>{t('feat.' + f.id)}</strong><span className="muted">{t('feat.' + f.id + '.d')}</span></span>
                </label>
                {!f.v1 ? <Badge>{t('common.soon')}</Badge> : f.external ? <Badge tone="info">{t('feat.external')}</Badge> : null}
              </li>))}
            </ul>
          </>)}
          {step === 'manage' && (<>
            <h2>{t('create.step.manage')}</h2>
            <p className="muted">{t('create.manageNote')}</p>
          </>)}
          {step === 'review' && (<>
            <h2>{t('create.step.review')}</h2>
            <div className="estimate">
              <div><span className="eyebrow">{t('create.estimate')}</span><strong>{num(est.min)} – {num(est.max)}</strong><span className="muted">{t('create.estimateNote')}</span></div>
              <div><span className="eyebrow">{t('create.bonus')}</span><strong>{num(CATALOG.starterBonus)}</strong><span className="muted">{t('create.bonusNote')}</span></div>
            </div>
            <ul className="mini-list">
              <li><Icon name="check" size={16} />{t('create.willHave.pages', { n: b.pages.length })}</li>
              <li><Icon name="check" size={16} />{t('create.willHave.checks')}</li>
              <li><Icon name="check" size={16} />{t('create.willHave.preview')}</li>
              <li><Icon name="alert" size={16} />{t('create.willHave.notPublished')}</li>
            </ul>
          </>)}
          <div className="wizard-nav">
            <Button kind="quiet" disabled={idx <= 0} onClick={() => setStep(visibleSteps[idx - 1])}>{t('common.back')}</Button>
            {(step === 'type' || step === 'visual') && <Button icon="sparkle" onClick={suggest}>{t('create.suggest')}</Button>}
            {step !== 'review'
              ? <Button kind="primary" disabled={!canNext} onClick={() => setStep(visibleSteps[idx + 1])}>{t('common.next')}</Button>
              : <Button kind="primary" icon="sparkle">{t('create.confirm', { max: num(est.max) })}</Button>}
          </div>
        </Card>
        <aside className="summary" aria-label={t('create.summary')}>
          <div className="eyebrow">{t('create.summary')}</div>
          <div className="phase"><Badge tone="info">{t('phase.idea')}</Badge><span className="muted">→ {t('phase.concept')} → {t('phase.working')} → {t('phase.published')}</span></div>
          <dl className="facts">
            <dt>{t('create.f.name')}</dt><dd>{b.business.name || '—'}</dd>
            <dt>{t('create.f.goal')}</dt><dd>{b.business.goal ? t('goal.' + b.business.goal) : '—'}</dd>
            <dt>{t('create.step.type')}</dt><dd>{b.type ? t('type.' + b.type) : '—'}</dd>
            <dt>{t('create.f.pages')}</dt><dd>{b.pages.length ? b.pages.map((p) => t('page.' + p)).join(', ') : '—'}</dd>
            <dt>{t('create.step.visual')}</dt><dd>{b.design.style ? t('style.' + b.design.style) : '—'}</dd>
            <dt>{t('create.step.features')}</dt><dd>{b.features.map((f) => t('feat.' + f)).join(', ') || '—'}</dd>
          </dl>
          <p className="muted small">{t('create.saved')}</p>
        </aside>
      </div>
    </div>
  );
}
