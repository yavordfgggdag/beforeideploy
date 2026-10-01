import { useState } from 'react';
import { Button, Card, PageHeader, SectionHeader, Tabs, Badge, EmptyState } from '../components/ui';
import { Icon } from '../components/Icon';
import { t, num } from '../i18n';
import { SITES } from '../demo/data';
import { go } from '../App';
import { StatusBadge, ago, urgency } from './common';

export function Sites() {
  return (
    <div className="page">
      <PageHeader title={t('nav.sites')} subtitle={t('sites.subtitle')}
        actions={<><Button kind="primary" icon="sparkle" onClick={() => go({ name: 'create' })}>{t('cta.create')}</Button><Button icon="folder">{t('cta.add')}</Button></>} />
      <div className="table" role="table" aria-label={t('nav.sites')}>
        <div className="tr th" role="row"><span role="columnheader">{t('sites.col.site')}</span><span role="columnheader">{t('sites.col.status')}</span><span role="columnheader">{t('sites.col.hosting')}</span><span role="columnheader">{t('sites.col.checked')}</span></div>
        {[...SITES].sort((a, b) => urgency(a) - urgency(b)).map((s) => (
          <a key={s.id} href={`#/site/${s.id}`} className="tr" role="row">
            <span role="cell" className="cell-main"><strong className="truncate" title={s.name}>{s.name}</strong><span className="muted truncate">{s.domain ?? s.url ?? s.framework}</span></span>
            <span role="cell"><StatusBadge s={s.status} /></span>
            <span role="cell">{s.provider ? <>{t('provider.' + s.provider)} <Badge tone={s.hosting === 'included' ? 'accent' : 'neutral'}>{t('hosting.' + s.hosting)}</Badge></> : <span className="muted">—</span>}</span>
            <span role="cell" className="muted">{ago(s.lastCheck)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

type Tab = 'summary' | 'checks' | 'code' | 'deploys' | 'domain' | 'monitoring' | 'backups';
export function SiteDetail({ id }: { id: string }) {
  const s = SITES.find((x) => x.id === id);
  const [tab, setTab] = useState<Tab>('summary');
  if (!s) return <div className="page"><EmptyState title={t('site.notFound')} action={<Button onClick={() => go({ name: 'sites' })}>{t('nav.sites')}</Button>} /></div>;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'summary', label: t('site.tab.summary') }, { id: 'checks', label: t('site.tab.checks'), badge: s.issues.length || undefined },
    { id: 'code', label: t('site.tab.code') }, { id: 'deploys', label: t('site.tab.deploys') }, { id: 'domain', label: t('site.tab.domain') },
    { id: 'monitoring', label: t('site.tab.monitoring') }, { id: 'backups', label: t('site.tab.backups') },
  ];
  return (
    <div className="page">
      <PageHeader title={s.name} subtitle={`${s.framework}${s.url ? ' · ' + s.url : ''}`}
        actions={<><Button icon="check">{t('action.check')}</Button><Button kind="primary" icon="rocket" disabled={s.status === 'blocked'}>{t('action.publish')}</Button></>} />
      <Tabs value={tab} options={tabs} onChange={setTab} label={t('site.tabs')} />
      {tab === 'summary' && (
        <div className="grid-2">
          <Card attention={s.issues.length ? (s.status === 'down' ? 'danger' : 'warning') : 'success'}>
            <SectionHeader title={t('site.state')} trailing={<StatusBadge s={s.status} />} />
            {s.issues.length ? (
              <ul className="issues">
                {s.issues.map((i) => (
                  <li key={i.id}>
                    <Badge tone={i.severity === 'blocker' ? 'danger' : i.severity === 'high' ? 'warning' : i.severity === 'medium' ? 'info' : 'neutral'} solid={i.severity === 'blocker'}>{t('sev.' + i.severity)}</Badge>
                    <div><strong>{i.title}</strong><p className="muted">{i.detail}</p></div>
                    <Button size="sm" kind={i.severity === 'blocker' ? 'primary' : 'secondary'} icon={i.fix === 'ai' ? 'ai' : i.fix === 'auto' ? 'check' : 'arrow'}>{t('fix.' + i.fix)}</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="lead"><Icon name="check" /> {t('site.allGood')}</p>}
          </Card>
          <Card>
            <SectionHeader title={t('site.facts')} />
            <dl className="facts">
              <dt>{t('site.hosting')}</dt><dd>{s.provider ? `${t('provider.' + s.provider)} · ${t('hosting.' + s.hosting)}` : t('site.notPublished')}</dd>
              <dt>{t('site.domain')}</dt><dd>{s.domain ?? '—'}</dd>
              <dt>{t('site.ssl')}</dt><dd>{s.sslDays !== null ? t('site.sslDays', { n: s.sslDays }) : '—'}</dd>
              <dt>{t('site.uptime')}</dt><dd>{s.uptime !== null ? `${num(s.uptime)} %` : '—'}</dd>
              <dt>{t('site.lastBackup')}</dt><dd>{s.lastBackup ? ago(s.lastBackup) : '—'}</dd>
            </dl>
          </Card>
        </div>
      )}
      {tab !== 'summary' && <Card><EmptyState icon={tab === 'backups' ? 'archive' : tab === 'monitoring' ? 'pulse' : tab === 'domain' ? 'globe' : tab === 'code' ? 'code' : 'check'} title={t('site.tab.' + tab)} message={t('proto.later')} /></Card>}
    </div>
  );
}
