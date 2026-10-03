import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, PageHeader, Segmented, Field, Badge, EmptyState, LoadingState } from '../components/ui';
import { Icon } from '../components/Icon';
import { t, num, getLang } from '../i18n';
import { hasEngine, run, themePreview, pickFolder, pickPhotos, EngineError, type EngineEvent } from '../lib/engine';
import { briefJSON, emptyBrief, errorKey, inlinePreview, pageFromHash, rankThemes, ESTIMATE, TONES, type Brief, type Theme, type Styles, type ContentResult, type GenerateResult, type EditResult, type SiteInfo } from '../lib/sitebuilder';
import { go } from '../App';

// Site Builder (S6) in the shared UI: the same three steps as the Mac app, on the same engine commands — pick a
// theme (bid new list / suggest), tell us about yourself (the brief), look and save (bid new preview / content /
// generate) — then "change it with words" (bid site edit). Nothing touches the disk before Save; the AI is a
// toggle that says its price first. Outside the desktop app there is no engine: the screen says so.

type Step = 'theme' | 'details' | 'preview' | 'done';
const STEPS: Step[] = ['theme', 'details', 'preview'];
const DRAFT_KEY = 'bid.createSite.brief';
const lang = () => getLang();

/** The plain-words message for an engine failure; the engine's own text when there is no better one. */
function explain(e: unknown): { text: string; code: string } {
  if (e instanceof EngineError) {
    const key = errorKey(e.code);
    const at = e.data && typeof e.data.readyAt === 'string' ? new Date(e.data.readyAt).toLocaleString() : '';
    return { text: key ? t(key, { at, detail: e.message }) : e.message, code: e.code };
  }
  return { text: String((e as Error)?.message ?? e), code: 'error' };
}

export function CreateSite() {
  const [brief, setBrief] = useState<Brief>(() => { try { return { ...emptyBrief(lang()), ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch { return emptyBrief(lang()); } });
  const [step, setStep] = useState<Step>('theme');
  const [themes, setThemes] = useState<Theme[]>([]);
  const [styles, setStyles] = useState<Styles>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [dir, setDir] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const set = (patch: Partial<Brief>) => setBrief((b) => ({ ...b, ...patch }));
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...brief, photos: [] })); } catch { /* storage unavailable */ } }, [brief]);

  useEffect(() => {
    if (!hasEngine()) return;
    let on = true;
    (async () => {
      try {
        const [list, st, account] = await Promise.all([
          run<Theme[]>(['new', 'list'], { lang: lang() }),
          run<Styles>(['new', 'styles'], { lang: lang() }),
          run<{ features?: Record<string, boolean> }>(['account', 'status'], { lang: lang() }).catch((): { features?: Record<string, boolean> } => ({})),
        ]);
        if (!on) return;
        setThemes(list);
        setStyles(st);
        const ready = !!account.features?.['ai.builtin'];
        setAiReady(ready);
        setUseAI(ready);
        setBrief((b) => (b.style ? b : { ...b, style: list.find((x) => x.id === b.theme)?.style ?? null }));
      } catch (e) {
        if (on) setLoadError(explain(e).text);
      }
    })();
    return () => { on = false; };
  }, []);

  const idx = STEPS.indexOf(step as never);
  const nameOK = brief.name.trim().length > 0;

  if (!hasEngine()) {
    return (
      <div className="page create">
        <PageHeader title={t('create.title')} subtitle={t('create.subtitle')} />
        <Card><EmptyState icon="rocket" title={t('create.noEngine')} message={t('err.noEngine')} action={<Button onClick={() => go({ name: 'sites' })}>{t('nav.sites')}</Button>} /></Card>
      </div>
    );
  }

  return (
    <div className="page create">
      <PageHeader title={t('create.title')} subtitle={t('create.subtitle')} />
      {step !== 'done' && (
        <ol className="stepper" aria-label={t('create.steps')}>
          {STEPS.map((s, i) => (
            <li key={s} className={s === step ? 'on' : i < idx ? 'done' : ''}>
              <button onClick={() => (i < idx || (i === idx + 1 && (s !== 'preview' || nameOK))) && setStep(s)} aria-current={s === step ? 'step' : undefined} disabled={i > idx + 1 || (s === 'preview' && !nameOK)}>
                <span className="dot">{i < idx ? <Icon name="check" size={12} /> : i + 1}</span>{t('create.step.' + s)}
              </button>
            </li>
          ))}
        </ol>
      )}
      {loadError ? <Card attention="danger"><p>{loadError}</p></Card> : null}
      {step === 'theme' && <ThemeStep themes={themes} brief={brief} onPick={(th) => set({ theme: th.id, style: th.style, palette: null })} onNext={() => setStep('details')} />}
      {step === 'details' && <DetailsStep brief={brief} set={set} themes={themes} styles={styles} aiReady={aiReady} useAI={useAI} setUseAI={setUseAI} dir={dir} setDir={setDir} onBack={() => setStep('theme')} onNext={() => setStep('preview')} nameOK={nameOK} />}
      {step === 'preview' && <PreviewStep brief={brief} set={set} useAI={useAI} dir={dir} onBack={() => setStep('details')} onSaved={(r) => { setResult(r); setStep('done'); }} />}
      {step === 'done' && result && <DoneStep result={result} aiReady={aiReady} onAnother={() => { setResult(null); setBrief(emptyBrief(lang())); setStep('theme'); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- step 1: the theme

function ThemeStep({ themes, brief, onPick, onNext }: { themes: Theme[]; brief: Brief; onPick: (t: Theme) => void; onNext: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [describing, setDescribing] = useState(false);
  const categories = useMemo(() => {
    const out: { id: string; title: string }[] = [{ id: 'all', title: t('create.allCategories') }];
    for (const th of themes) if (!out.some((c) => c.id === th.category)) out.push({ id: th.category, title: th.categoryTitle });
    return out;
  }, [themes]);
  const shown = useMemo(() => {
    const inCategory = themes.filter((th) => category === 'all' || th.category === category);
    if (query.trim()) return rankThemes(inCategory, query);
    return showAll || category !== 'all' ? inCategory : inCategory.filter((th) => th.featured);
  }, [themes, query, category, showAll]);
  const hidden = themes.length - shown.length;
  const landing = themes.find((th) => th.id === 'landing');

  return (
    <div className="create-grid">
      <Card className="create-main">
        <div className="theme-tools">
          <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(describing ? 'create.other.describe' : 'create.search')} aria-label={t('create.search')} />
          {describing && (
            <p className="note"><Icon name="sparkle" size={14} /> {t('create.other.hint')} {landing && <Button size="sm" onClick={() => { onPick(landing); setDescribing(false); setQuery(''); }}>{t('create.other.fallback')}</Button>}</p>
          )}
          <div className="choices">{categories.map((c) => <button key={c.id} className={category === c.id ? 'choice on' : 'choice'} onClick={() => setCategory(c.id)} aria-pressed={category === c.id}>{c.title}</button>)}</div>
        </div>
        {!themes.length ? <LoadingState label={t('create.loadingThemes')} /> : (
          <>
            <div className="theme-grid">
              {shown.map((th) => <ThemeCard key={th.id} theme={th} selected={brief.theme === th.id} onPick={() => onPick(th)} />)}
              {!query && category === 'all' && !describing && (
                <button className="theme other" onClick={() => { setDescribing(true); setShowAll(true); }}>
                  <span className="theme-pic dashed"><Icon name="sparkle" size={22} /></span>
                  <strong>{t('create.other.title')}</strong><span>{t('create.other.subtitle')}</span>
                </button>
              )}
            </div>
            {!query && category === 'all' && !showAll && hidden > 0 && <Button onClick={() => setShowAll(true)}>{t('create.moreThemes', { n: hidden })}</Button>}
            {query && !shown.length && <EmptyState icon="sparkle" title={t('create.noMatch')} message={t('create.noMatchHint')} />}
          </>
        )}
        <div className="wizard-nav"><span /><Button kind="primary" onClick={onNext} disabled={!themes.length}>{t('common.next')}</Button></div>
      </Card>
      <Summary brief={brief} themes={themes} />
    </div>
  );
}

function ThemeCard({ theme, selected, onPick }: { theme: Theme; selected: boolean; onPick: () => void }) {
  const [pic, setPic] = useState<string | null>(null);
  useEffect(() => { let on = true; themePreview(theme.id).then((u) => on && setPic(u)); return () => { on = false; }; }, [theme.id]);
  return (
    <button className={selected ? 'theme on' : 'theme'} onClick={onPick} aria-pressed={selected}>
      {pic ? <img className="theme-pic" src={pic} alt="" /> : <span className="theme-pic" style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}88)` }} />}
      <strong>{theme.title}</strong>
      <span>{theme.description}</span>
      <small>{t('create.pages', { n: theme.pages })}</small>
    </button>
  );
}

// ---------------------------------------------------------------- step 2: the brief

function DetailsStep({ brief, set, themes, styles, aiReady, useAI, setUseAI, dir, setDir, onBack, onNext, nameOK }: { brief: Brief; set: (p: Partial<Brief>) => void; themes: Theme[]; styles: Styles; aiReady: boolean; useAI: boolean; setUseAI: (v: boolean) => void; dir: string; setDir: (d: string) => void; onBack: () => void; onNext: () => void; nameOK: boolean }) {
  const services = brief.services;
  const setService = (i: number, patch: Partial<Brief['services'][number]>) => set({ services: services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const contacts = brief.contacts;
  // S7: examples for this kind of site, in the site's language — placeholders only
  const hints = themes.find((th) => th.id === brief.theme)?.hints?.[brief.lang];
  const eg = (i: number, col: number, fallback: string) => hints?.services[i]?.[col] || fallback;
  return (
    <div className="create-grid">
      <Card className="create-main">
        <h2>{t('create.step.details')}</h2>
        <Field label={t('create.f.name')}><input value={brief.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('create.f.namePh')} /></Field>
        <Field label={t('create.f.offer')} hint={t('create.f.offerHint')}><textarea rows={3} value={brief.offer} onChange={(e) => set({ offer: e.target.value })} placeholder={hints?.offer || t('create.f.offerPh')} /></Field>
        <Field label={t('create.f.audience')} hint={t('create.f.audienceHint')}><input value={brief.audience} onChange={(e) => set({ audience: e.target.value })} placeholder={hints?.audience || t('create.f.audiencePh')} /></Field>
        <div className="field">
          <span className="field-label">{t('create.f.services')}</span>
          {services.map((s, i) => (
            <div className="service-row" key={i}>
              <input value={s.name} onChange={(e) => setService(i, { name: e.target.value })} placeholder={eg(i, 0, t('create.f.serviceName'))} aria-label={t('create.f.serviceName')} />
              <input value={s.price} onChange={(e) => setService(i, { price: e.target.value })} placeholder={eg(i, 1, t('create.f.servicePrice'))} aria-label={t('create.f.servicePrice')} />
              <input value={s.text} onChange={(e) => setService(i, { text: e.target.value })} placeholder={eg(i, 2, t('create.f.serviceText'))} aria-label={t('create.f.serviceText')} />
              <button className="icon-btn" aria-label={t('common.remove')} onClick={() => set({ services: services.filter((_, j) => j !== i) })} disabled={services.length === 1}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <div><Button size="sm" icon="plus" onClick={() => set({ services: [...services, { name: '', price: '', text: '' }] })} disabled={services.length >= 8}>{t('create.f.addService')}</Button></div>
          <span className="field-hint">{t('create.f.servicesHint')}</span>
        </div>
        <div className="field">
          <span className="field-label">{t('create.f.contacts')}</span>
          <div className="grid-2 tight">
            <input value={contacts.email} onChange={(e) => set({ contacts: { ...contacts, email: e.target.value } })} placeholder={t('create.f.email')} aria-label={t('create.f.email')} type="email" />
            <input value={contacts.phone} onChange={(e) => set({ contacts: { ...contacts, phone: e.target.value } })} placeholder={t('create.f.phone')} aria-label={t('create.f.phone')} type="tel" />
            <input value={contacts.instagram} onChange={(e) => set({ contacts: { ...contacts, instagram: e.target.value } })} placeholder="Instagram" aria-label="Instagram" />
            <input value={contacts.address} onChange={(e) => set({ contacts: { ...contacts, address: e.target.value } })} placeholder={t('create.f.address')} aria-label={t('create.f.address')} />
          </div>
          <span className="field-hint">{t('create.f.contactsHint')}</span>
        </div>
        <Field label={t('create.f.hours')} hint={t('create.f.hoursHint')}><textarea rows={3} value={brief.hours} onChange={(e) => set({ hours: e.target.value })} placeholder={t('create.f.hoursPh')} /></Field>
        <div className="field">
          <span className="field-label">{t('create.f.style')}</span>
          <div className="style-grid">
            {Object.entries(styles).map(([id, s]) => (
              <button key={id} className={brief.style === id ? 'style on' : 'style'} onClick={() => set({ style: id, palette: null })} aria-pressed={brief.style === id}>
                <strong>{t('style.' + id)}</strong><span>{t('style.' + id + '.hint')}</span>
                <span className="dots">{s.palettes.map((p) => <i key={p.id} style={{ background: p.accent }} />)}</span>
              </button>
            ))}
          </div>
          {brief.style && styles[brief.style] && (
            <div className="palettes">
              <span className="muted">{t('create.f.palette')}</span>
              {styles[brief.style].palettes.map((p) => (
                <button key={p.id} className={brief.palette === p.id ? 'swatch on' : 'swatch'} style={{ background: p.bg }} onClick={() => set({ palette: brief.palette === p.id ? null : p.id })} aria-pressed={brief.palette === p.id} title={t('palette.' + p.id)} aria-label={t('palette.' + p.id)}>
                  <i style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accent2})` }} />
                </button>
              ))}
            </div>
          )}
          <Segmented label={t('create.f.scheme')} value={brief.scheme} onChange={(v) => set({ scheme: v })} options={[{ id: 'auto', label: t('scheme.auto') }, { id: 'light', label: t('scheme.light') }, { id: 'dark', label: t('scheme.dark') }]} />
          <span className="field-hint">{t('create.f.schemeHint')}</span>
        </div>
        <div className="field">
          <span className="field-label">{t('create.f.photos')}</span>
          <div className="chips">
            {brief.photos.map((p) => <span key={p.path} className="chip">{p.path.split(/[\\/]/).pop()}<button aria-label={t('common.remove')} onClick={() => set({ photos: brief.photos.filter((x) => x.path !== p.path) })}><Icon name="x" size={12} /></button></span>)}
            <Button size="sm" icon="folder" onClick={async () => { const paths = await pickPhotos(t('create.f.photos')); if (paths.length) set({ photos: [...brief.photos, ...paths.filter((p) => !brief.photos.some((x) => x.path === p)).map((path) => ({ path, alt: '' }))].slice(0, 12) }); }}>{t('create.f.choosePhotos')}</Button>
          </div>
          <span className="field-hint">{t('create.f.photosHint')}</span>
        </div>
        <Field label={t('create.f.tone')} hint={t('create.f.toneHint')}><Segmented label={t('create.f.tone')} value={brief.tone ?? 'auto'} onChange={(v) => set({ tone: v === 'auto' ? null : v })} options={[{ id: 'auto', label: t('tone.auto') }, ...TONES.map((x) => ({ id: x, label: t('tone.' + x) }))]} /></Field>
        <Field label={t('create.f.language')}><Segmented label={t('create.f.language')} value={brief.lang} onChange={(v) => set({ lang: v })} options={[{ id: 'bg', label: 'Български' }, { id: 'en', label: 'English' }]} /></Field>
        <div className="field">
          <span className="field-label">{t('create.f.folder')}</span>
          <div className="folder-row"><code className="truncate">{dir || t('create.f.folderNone')}</code><Button size="sm" icon="folder" onClick={async () => { const d = await pickFolder(t('create.f.folder')); if (d) setDir(d); }}>{t('create.f.chooseFolder')}</Button></div>
          <span className="field-hint">{t('create.f.folderHint')}</span>
        </div>
        <div className="ai-toggle">
          <label><input type="checkbox" checked={useAI && aiReady} disabled={!aiReady} onChange={(e) => setUseAI(e.target.checked)} /><span><strong>{t('create.ai.toggle')}</strong><span className="muted">{aiReady ? t('create.ai.hint', { min: num(ESTIMATE.create.min), max: num(ESTIMATE.create.max) }) : t('create.ai.needs')}</span></span></label>
        </div>
        <div className="wizard-nav">
          <Button kind="quiet" onClick={onBack}>{t('common.back')}</Button>
          <Button kind="primary" onClick={onNext} disabled={!nameOK}>{t('common.next')}</Button>
        </div>
      </Card>
      <Summary brief={brief} themes={[]} />
    </div>
  );
}

// ---------------------------------------------------------------- step 3: look and save

interface AIStep { id: string; label: string; status: string; summary: string }

function PreviewStep({ brief, set, useAI, dir, onBack, onSaved }: { brief: Brief; set: (p: Partial<Brief>) => void; useAI: boolean; dir: string; onBack: () => void; onSaved: (r: GenerateResult) => void }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [page, setPage] = useState('index.html');
  const [phone, setPhone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<{ key: string; result: ContentResult } | null>(null);
  const [aiSteps, setAiSteps] = useState<AIStep[]>([]);
  const [aiError, setAiError] = useState<{ text: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const key = briefJSON(brief, { photos: false });
  const current = content?.key === key ? content.result : null;

  useEffect(() => {
    let on = true;
    (async () => {
      setError(null);
      let contentFile = current?.contentFile ?? null;
      if (useAI && !contentFile) {
        setAiSteps([]);
        setAiError(null);
        try {
          const r = await run<ContentResult>(['new', 'content', '--brief', key], {
            lang: lang(),
            onEvent: (e: EngineEvent) => {
              if (e.type !== 'step' || !on) return;
              const s: AIStep = { id: String(e.id), label: String(e.label ?? e.id), status: String(e.status ?? ''), summary: String(e.summary ?? '') };
              setAiSteps((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]));
            },
          });
          if (!on) return;
          setContent({ key, result: r });
          contentFile = r.contentFile;
          if (!brief.style && r.styleSuggestion) set({ style: r.styleSuggestion });
        } catch (e) {
          if (on) setAiError(explain(e));
        }
      }
      try {
        const args = ['new', 'preview', '--brief', key];
        if (contentFile) args.push('--content', contentFile);
        const f = await run<Record<string, string>>(args, { lang: lang() });
        if (on) { setFiles(f); setPage('index.html'); }
      } catch (e) {
        if (on) setError(explain(e).text);
      }
    })();
    return () => { on = false; };
  }, [key, useAI]); // eslint-disable-line react-hooks/exhaustive-deps

  const srcdoc = useMemo(() => (files ? inlinePreview(files, page) : ''), [files, page]);
  const frame = useRef<HTMLIFrameElement>(null);
  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (ev) => {
      const a = (ev.target as HTMLElement).closest('a');
      const target = a?.getAttribute('href') ? pageFromHash(a.getAttribute('href')!) : null;
      if (target && files && files[target]) { ev.preventDefault(); setPage(target); }
    });
  };

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const args = ['new', 'generate', '--brief', briefJSON(brief), '--dir', dir];
      if (useAI && current) args.push('--content', current.contentFile);
      onSaved(await run<GenerateResult>(args, { lang: lang() }));
    } catch (e) {
      setSaveError(explain(e).text);
    }
    setBusy(false);
  };

  return (
    <div className="create-grid wide">
      <Card className="create-main preview-card">
        <div className="preview-bar">
          <Segmented label={t('create.preview.width')} value={phone ? 'phone' : 'desktop'} onChange={(v) => setPhone(v === 'phone')} options={[{ id: 'desktop', label: t('create.preview.desktop') }, { id: 'phone', label: t('create.preview.phone') }]} />
          {files && <span className="muted">{t('create.preview.hint')}</span>}
        </div>
        {useAI && (aiSteps.length > 0 || aiError) && (
          <div className="ai-progress" aria-live="polite">
            {aiSteps.map((s) => <span key={s.id} className={'ai-step ' + s.status}>{s.status === 'running' ? <span className="spinner small" /> : <Icon name={s.status === 'pass' ? 'check' : 'alert'} size={12} />}{s.label}</span>)}
            {aiError && <span className="ai-error"><Icon name="alert" size={14} /> {aiError.text} — {t('create.ai.fallback')}</span>}
            {current && !aiError && <Badge tone="success">{current.usage.charged != null ? t('create.ai.charged', { n: num(current.usage.charged) }) : t('create.ai.written')}</Badge>}
          </div>
        )}
        <div className={phone ? 'preview-frame phone' : 'preview-frame'}>
          {error ? <EmptyState icon="alert" title={t('common.errorTitle')} message={error} /> : files ? <iframe ref={frame} title={t('create.preview.label')} srcDoc={srcdoc} sandbox="allow-same-origin" onLoad={onLoad} /> : <LoadingState label={t('create.rendering')} />}
        </div>
        {saveError && <p className="ai-error" role="alert"><Icon name="alert" size={14} /> {saveError}</p>}
        <div className="wizard-nav">
          <Button kind="quiet" onClick={onBack} disabled={busy}>{t('common.back')}</Button>
          <span className="muted">{dir ? dir : t('create.f.folderNone')}</span>
          <Button kind="primary" icon="check" onClick={save} disabled={busy || !files || !dir}>{busy ? t('create.saving') : t('create.save')}</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- after save: the site, and words to change it

function DoneStep({ result, aiReady, onAnother }: { result: GenerateResult; aiReady: boolean; onAnother: () => void }) {
  const [say, setSay] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [last, setLast] = useState<EditResult | null>(null);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);
  const examples = ['create.edit.ex.darkMode', 'create.edit.ex.darker', 'create.edit.ex.reviews', 'create.edit.ex.prices', 'create.edit.ex.title', 'create.edit.ex.calm'];
  const load = async () => { try { setInfo(await run<SiteInfo>(['site', 'info', '--project', result.path], { lang: lang() })); } catch { /* not a generated site: no history */ } };
  useEffect(() => { load(); }, [result.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (force: boolean) => {
    const words = say.trim();
    if (!words) return;
    setBusy(true);
    setError(null);
    try {
      const args = ['site', 'edit', '--project', result.path, '--say', words];
      if (force) args.push('--force');
      const r = await run<EditResult>(args, { lang: lang() });
      setLast(r);
      setSay('');
      await load();
    } catch (e) {
      setError(explain(e));
    }
    setBusy(false);
  };
  const undo = async () => {
    setBusy(true);
    setError(null);
    try { await run(['site', 'undo', '--project', result.path], { lang: lang() }); setLast(null); await load(); } catch (e) { setError(explain(e)); }
    setBusy(false);
  };

  return (
    <div className="create-grid">
      <Card className="create-main" attention="success">
        <h2><Icon name="check" /> {t('create.done.title', { name: result.project.name })}</h2>
        <p className="muted"><code>{result.path}</code></p>
        <ul className="mini-list">
          <li><Icon name="check" size={16} />{t('create.done.files', { n: result.files.length })}</li>
          <li><Icon name="check" size={16} />{result.git ? t('create.done.git') : t('create.done.noGit')}</li>
          <li><Icon name="alert" size={16} />{t('create.done.notPublished')}</li>
        </ul>
        <h3>{t('create.edit.title')}</h3>
        <p className="muted">{t('create.edit.subtitle')}</p>
        <div className="say-row">
          <input value={say} onChange={(e) => setSay(e.target.value)} placeholder={t('create.edit.placeholder')} onKeyDown={(e) => { if (e.key === 'Enter') apply(false); }} aria-label={t('create.edit.title')} />
          <Button kind="primary" onClick={() => apply(false)} disabled={busy || !say.trim()}>{busy ? t('create.edit.working') : t('create.edit.apply')}</Button>
        </div>
        <div className="chips">{examples.map((k) => <button key={k} className="chip" onClick={() => setSay(t(k))}>{t(k)}</button>)}</div>
        <p className="field-hint">{aiReady ? t('create.edit.costHint', { min: num(ESTIMATE.edit.min), max: num(ESTIMATE.edit.max) }) : t('create.edit.localOnly')}</p>
        {error && (
          <p className="ai-error" role="alert"><Icon name="alert" size={14} /> {error.text} {error.code === 'site_modified' && <Button size="sm" kind="danger" onClick={() => apply(true)}>{t('create.edit.replaceAnyway')}</Button>}</p>
        )}
        {last && (
          <p className="muted"><Badge tone="success">{t('create.edit.applied', { n: last.applied.length })}</Badge> {last.summary}{last.refused.length ? ` · ${t('create.edit.refused', { why: last.refused.join('; ') })}` : ''}{last.usage?.charged != null ? ` · ${t('create.ai.charged', { n: num(last.usage.charged) })}` : ''}</p>
        )}
        {info?.history?.length ? (
          <div className="history">
            <div className="section-header"><h3>{t('create.edit.history')}</h3>{info.history.some((h) => h.kind === 'edit') && <Button size="sm" onClick={undo} disabled={busy}>{t('create.edit.undo')}</Button>}</div>
            <ul className="mini-list">{info.history.map((h, i) => <li key={i}><Icon name={h.kind === 'edit' ? 'ai' : h.kind === 'undo' ? 'arrow' : 'sparkle'} size={14} />{h.say}{h.sha ? <code className="muted"> {h.sha}</code> : null}</li>)}</ul>
          </div>
        ) : null}
        <div className="wizard-nav">
          <Button onClick={onAnother}>{t('create.done.another')}</Button>
          <Button kind="primary" icon="arrow" onClick={() => go({ name: 'sites' })}>{t('nav.sites')}</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- the sidebar

function Summary({ brief, themes }: { brief: Brief; themes: Theme[] }) {
  const th = themes.find((x) => x.id === brief.theme);
  return (
    <aside className="summary" aria-label={t('create.summary')}>
      <div className="eyebrow">{t('create.summary')}</div>
      <dl className="facts">
        <dt>{t('create.step.theme')}</dt><dd>{th?.title ?? brief.theme}</dd>
        <dt>{t('create.f.name')}</dt><dd>{brief.name || '—'}</dd>
        <dt>{t('create.f.style')}</dt><dd>{brief.style ? t('style.' + brief.style) + (brief.palette ? ' · ' + t('palette.' + brief.palette) : '') : '—'}</dd>
        <dt>{t('create.f.scheme')}</dt><dd>{t('scheme.' + brief.scheme)}</dd>
        <dt>{t('create.f.services')}</dt><dd>{brief.services.filter((s) => s.name.trim()).length || '—'}</dd>
        <dt>{t('create.f.photos')}</dt><dd>{brief.photos.length || '—'}</dd>
      </dl>
      <p className="muted small">{t('create.noFake')}</p>
      <p className="muted small">{t('create.saved')}</p>
    </aside>
  );
}
