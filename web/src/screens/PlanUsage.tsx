import { useState } from 'react';
import { Button, Card, PageHeader, SectionHeader, Meter, Badge, Segmented } from '../components/ui';
import { t, num, money, time, getLang } from '../i18n';
import { ACCOUNT, CATALOG } from '../demo/data';
import { includedAvailable, released, readyAt, GUARD_24H, GUARD_7D, HOUR } from '../lib/credits';

export function PlanUsage() {
  const now = Date.now();
  const plan = CATALOG.plans.find((p) => p.id === ACCOUNT.plan)!;
  const period = { start: ACCOUNT.periodStart, budget: plan.credits };
  const av = includedAvailable(period, ACCOUNT.spends, 0, now);
  const rel = released(period, now);
  const spent = av.spentIncluded;
  const last = (h: number) => ACCOUNT.spends.filter((s) => s.at > now - h * HOUR).reduce((a, s) => a + s.credits, 0);
  const siteTask = readyAt(period, ACCOUNT.spends, 0, 30_000, now);
  const carried = ACCOUNT.carried.reduce((a, c) => a + c.credits, 0);
  const [yearly, setYearly] = useState<'m' | 'y'>('m');
  return (
    <div className="page">
      <PageHeader title={t('nav.plan')} subtitle={t('plan.current', { plan: t('plan.' + plan.id), date: new Date(ACCOUNT.renewsAt).toLocaleDateString(getLang() === 'bg' ? 'bg-BG' : 'en-GB') })}
        actions={<Button kind="primary">{t('plan.change')}</Button>} />
      <div className="grid-3">
        <Card>
          <SectionHeader title={t('usage.included')} eyebrow={t('usage.thisPeriod')} />
          <div className="big">{num(Math.max(0, rel - spent))}<span className="muted"> / {num(plan.credits)}</span></div>
          <Meter label={t('usage.included')} total={plan.credits} valueText={t('usage.meterText', { spent: num(spent), released: num(rel), total: num(plan.credits) })}
            segments={[{ value: spent, tone: 'accent' }, { value: Math.max(0, rel - spent), tone: 'released' }]} />
          <p className="muted small">{t('usage.releaseExplain', { left: num(plan.credits - rel) })}</p>
        </Card>
        <Card>
          <SectionHeader title={t('usage.last24h')} eyebrow={t('usage.guard')} />
          <div className="big">{num(last(24))}<span className="muted"> / {num(Math.floor(plan.credits * GUARD_24H))}</span></div>
          <Meter label={t('usage.last24h')} total={Math.floor(plan.credits * GUARD_24H)} valueText={num(last(24))} segments={[{ value: last(24), tone: 'accent' }]} />
          <p className="muted small">{t('usage.rolling')}</p>
        </Card>
        <Card>
          <SectionHeader title={t('usage.last7d')} eyebrow={t('usage.guard')} />
          <div className="big">{num(last(168))}<span className="muted"> / {num(Math.floor(plan.credits * GUARD_7D))}</span></div>
          <Meter label={t('usage.last7d')} total={Math.floor(plan.credits * GUARD_7D)} valueText={num(last(168))} segments={[{ value: last(168), tone: 'accent' }]} />
          <p className="muted small">{t('usage.rolling')}</p>
        </Card>
      </div>
      <Card attention="info">
        <SectionHeader title={t('usage.whenTask')} />
        <p className="lead">{siteTask && siteTask <= now ? t('usage.taskNow') : siteTask ? t('usage.taskAt', { at: time(siteTask) }) : t('usage.taskNever')}</p>
        <p className="muted small">{t('usage.reason.' + av.reason)}</p>
      </Card>
      <div className="grid-3">
        <Card><SectionHeader title={t('usage.carried')} /><div className="big">{num(carried)}</div><p className="muted small">{t('usage.carriedNote')}</p></Card>
        <Card><SectionHeader title={t('usage.packs')} /><div className="big">{num(ACCOUNT.packs)}</div><p className="muted small">{t('usage.packsNote')}</p></Card>
        <Card><SectionHeader title={t('usage.cloudMinutes')} /><div className="big">{num(ACCOUNT.cloudMinutes.used)}<span className="muted"> / {num(ACCOUNT.cloudMinutes.total)}</span></div><p className="muted small">{t('usage.cloudNote')}</p></Card>
      </div>
      <SectionHeader title={t('plan.compare')} trailing={<Segmented label={t('plan.billing')} value={yearly} onChange={setYearly} options={[{ id: 'm', label: t('plan.monthly') }, { id: 'y', label: t('plan.yearly') }]} />} />
      <div className="plans">
        {CATALOG.plans.map((p) => (
          <Card key={p.id} className={p.id === plan.id ? 'plan plan-current' : 'plan'}>
            <div className="plan-head"><strong>{t('plan.' + p.id)}</strong>{p.id === plan.id && <Badge tone="accent">{t('plan.yours')}</Badge>}</div>
            <div className="price">{yearly === 'y' && p.yearly ? money(p.yearly) : money(p.price)}<span className="muted small"> {yearly === 'y' && p.yearly ? t('plan.perYear') : t('plan.perMonth')}</span></div>
            <ul className="mini-list">
              <li>{t('plan.f.credits', { n: num(p.credits) })}</li>
              <li>{t('plan.f.sites', { n: p.sites })}</li>
              <li>{t('plan.f.netlify', { tier: p.netlify })}</li>
              {yearly === 'y' && p.yearly && <li>{t('plan.f.domain')}</li>}
            </ul>
          </Card>
        ))}
      </div>
      <p className="muted small">{t('plan.hostingNote')}</p>
    </div>
  );
}
