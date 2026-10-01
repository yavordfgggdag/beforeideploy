import { PageHeader, Card, SectionHeader, Segmented, Field } from '../components/ui';
import { t, getLang, type Lang } from '../i18n';

export function Settings({ theme, onTheme, onLang }: { theme: 'system' | 'light' | 'dark'; onTheme: (v: 'system' | 'light' | 'dark') => void; onLang: (l: Lang) => void }) {
  return (
    <div className="page">
      <PageHeader title={t('nav.settings')} />
      <Card>
        <SectionHeader title={t('settings.general')} />
        <Field label={t('settings.appearance')}><Segmented label={t('settings.appearance')} value={theme} onChange={onTheme} options={[{ id: 'system', label: t('appearance.system') }, { id: 'light', label: t('appearance.light') }, { id: 'dark', label: t('appearance.dark') }]} /></Field>
        <Field label={t('settings.language')}><Segmented label={t('settings.language')} value={getLang()} onChange={onLang} options={[{ id: 'bg', label: 'Български' }, { id: 'en', label: 'English' }]} /></Field>
      </Card>
      <Card><SectionHeader title={t('settings.data')} /><p className="muted">{t('settings.dataNote')}</p></Card>
    </div>
  );
}
