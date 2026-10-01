import { Button, Card, PageHeader, SectionHeader, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { SITES } from '../demo/data';
import { go } from '../App';
import { StatusBadge, ago, urgency } from './common';

export function Overview() {
  const attention = SITES.filter((s) => s.status === 'down' || s.status === 'blocked' || s.status === 'warnings').sort((a, b) => urgency(a) - urgency(b));
  const live = SITES.filter((s) => s.url && s.status !== 'draft');
  const draft = SITES.find((s) => s.status === 'draft');
  return (
    <div className="page">
      <PageHeader title={t('overview.title')} subtitle={t('overview.subtitle')}
        actions={<>
          <Button kind="primary" icon="sparkle" onClick={() => go({ name: 'create' })}>{t('cta.create')}</Button>
          <Button icon="folder" onClick={() => go({ name: 'sites' })}>{t('cta.add')}</Button>
        </>} />

      <div className="strip" role="list" aria-label={t('overview.working')}>
        <div className="strip-item" role="listitem"><span className="strip-num">{live.length}</span><span>{t('overview.live')}</span></div>
        <div className="strip-item" role="listitem"><span className="strip-num">{SITES.filter((s) => s.uptime !== null).length}</span><span>{t('overview.monitored')}</span></div>
        <div className="strip-item" role="listitem"><span className="strip-num">{SITES.filter((s) => s.lastBackup).length}</span><span>{t('overview.backedUp')}</span></div>
        <div className="strip-item" role="listitem"><span className="strip-num">{attention.length}</span><span>{t('overview.needAttention')}</span></div>
      </div>

      <SectionHeader title={t('overview.attention')} trailing={<Badge tone={attention.length ? 'warning' : 'success'}>{attention.length ? t('overview.count', { n: attention.length }) : t('overview.allGood')}</Badge>} />
      <div className="list">
        {attention.map((s) => {
          const top = s.issues[0];
          return (
            <Card key={s.id} attention={s.status === 'down' ? 'danger' : 'warning'} className="row">
              <div className="row-main">
                <div className="row-title"><StatusBadge s={s.status} /> <a href={`#/site/${s.id}`}>{s.name}</a></div>
                <div className="row-sub">{top?.title} · {ago(s.lastCheck)}</div>
              </div>
              <Button kind={s.status === 'down' ? 'primary' : 'secondary'} icon={s.status === 'down' ? 'archive' : 'ai'} onClick={() => go({ name: 'site', id: s.id })}>
                {s.status === 'down' ? t('action.restore') : t('action.fix', { n: s.issues.length })}
              </Button>
            </Card>
          );
        })}
      </div>

      <div className="grid-2">
        <Card>
          <SectionHeader title={t('overview.working')} />
          <ul className="mini-list">
            {live.filter((s) => s.status === 'ready').map((s) => (
              <li key={s.id}><Icon name="check" size={16} /><a href={`#/site/${s.id}`}>{s.name}</a><span className="muted">{t('overview.lastDeploy', { ago: ago(s.lastDeploy!) })}</span></li>
            ))}
          </ul>
        </Card>
        <Card attention="accent">
          <SectionHeader title={t('overview.next')} eyebrow={t('overview.nextEyebrow')} />
          {draft ? (
            <>
              <p className="lead">{t('overview.nextDraft', { name: draft.name })}</p>
              <Button kind="primary" icon="arrow" onClick={() => go({ name: 'create' })}>{t('overview.continue')}</Button>
            </>
          ) : <p className="muted">{t('overview.nothingNext')}</p>}
        </Card>
      </div>
    </div>
  );
}
