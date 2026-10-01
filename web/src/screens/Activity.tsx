import { PageHeader, Card, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { t, num } from '../i18n';
import { ACTIVITY } from '../demo/data';
import { ago } from './common';

const ICON: Record<string, string> = { deploy: 'rocket', check: 'check', incident: 'alert', ai: 'ai', backup: 'archive', billing: 'plan' };
export function Activity() {
  return (
    <div className="page">
      <PageHeader title={t('nav.activity')} subtitle={t('activity.subtitle')} />
      <Card>
        <ol className="timeline">
          {ACTIVITY.map((a, i) => (
            <li key={i} className={`tl-${a.kind}`}>
              <span className="tl-icon"><Icon name={ICON[a.kind]} size={16} /></span>
              <div><strong>{a.site}</strong><p>{a.text}</p></div>
              <span className="muted small">{ago(a.at)}{a.credits ? <> · <Badge>{t('activity.credits', { n: num(a.credits) })}</Badge></> : null}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
