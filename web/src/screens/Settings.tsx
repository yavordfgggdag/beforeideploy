import { useEffect, useState } from 'react';
import { PageHeader, Card, SectionHeader, Segmented, Field } from '../components/ui';
import { t, getLang, type Lang } from '../i18n';
import { hasEngine, run } from '../lib/engine';

type CloudEngine = 'claude' | 'codex';
interface AssistantSettings { cloudEngine?: string }

export function Settings({ theme, onTheme, onLang }: { theme: 'system' | 'light' | 'dark'; onTheme: (v: 'system' | 'light' | 'dark') => void; onLang: (l: Lang) => void }) {
  // the cloud AI answers with Claude or Codex: the engine keeps the choice (bid ai settings), so every app sees it
  const [engine, setEngine] = useState<CloudEngine | null>(null);
  useEffect(() => {
    if (!hasEngine()) return;
    run<AssistantSettings>(['ai', 'settings'], { lang: getLang() }).then((s) => setEngine(s.cloudEngine === 'codex' ? 'codex' : 'claude')).catch(() => setEngine('claude'));
  }, []);
  const chooseEngine = async (v: CloudEngine) => {
    setEngine(v);
    try { await run(['ai', 'settings', '--json', JSON.stringify({ cloudEngine: v })], { lang: getLang() }); } catch { /* the engine said why; the next load shows the stored value */ }
  };
  return (
    <div className="page">
      <PageHeader title={t('nav.settings')} />
      <Card>
        <SectionHeader title={t('settings.general')} />
        <Field label={t('settings.appearance')}><Segmented label={t('settings.appearance')} value={theme} onChange={onTheme} options={[{ id: 'system', label: t('appearance.system') }, { id: 'light', label: t('appearance.light') }, { id: 'dark', label: t('appearance.dark') }]} /></Field>
        <Field label={t('settings.language')}><Segmented label={t('settings.language')} value={getLang()} onChange={onLang} options={[{ id: 'bg', label: 'Български' }, { id: 'en', label: 'English' }]} /></Field>
      </Card>
      {hasEngine() && engine && (
        <Card>
          <SectionHeader title={t('settings.ai')} />
          <Field label={t('settings.engine')} hint={t('settings.engineHint')}><Segmented label={t('settings.engine')} value={engine} onChange={chooseEngine} options={[{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }]} /></Field>
        </Card>
      )}
      <Card><SectionHeader title={t('settings.data')} /><p className="muted">{t('settings.dataNote')}</p></Card>
    </div>
  );
}
