import { Badge, type Tone } from '../components/ui';
import { t } from '../i18n';
import type { Site, SiteStatus } from '../demo/data';

export const statusTone: Record<SiteStatus, Tone> = { ready: 'success', warnings: 'warning', blocked: 'danger', down: 'danger', draft: 'neutral' };
export const StatusBadge = ({ s }: { s: SiteStatus }) => <Badge tone={statusTone[s]}>{t('status.' + s)}</Badge>;

export function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return t('time.now');
  if (m < 60) return t('time.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('time.hours', { n: h });
  return t('time.days', { n: Math.round(h / 24) });
}

export const urgency = (s: Site) => (s.status === 'down' ? 0 : s.status === 'blocked' ? 1 : s.status === 'warnings' ? 2 : s.status === 'draft' ? 3 : 4);
