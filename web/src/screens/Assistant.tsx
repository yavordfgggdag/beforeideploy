import { useState } from 'react';
import { Button, Card, PageHeader, Badge } from '../components/ui';
import { Icon } from '../components/Icon';
import { t, num } from '../i18n';

// Prototype of the assistant layout (docs §8.1): real stages, visible context before sending, cost, stop, review, undo.
const STAGES = ['inspect', 'prepare', 'verify'] as const;
export function Assistant() {
  const [stage, setStage] = useState<number>(3);
  return (
    <div className="page">
      <PageHeader title={t('nav.assistant')} subtitle="Studio North" actions={<Badge tone="accent">{t('ai.model.sonnet')}</Badge>} />
      <div className="chat">
        <div className="msg msg-user">{t('ai.demo.q')}</div>
        <div className="msg msg-ai">
          <ol className="stages" aria-label={t('ai.stages')}>
            {STAGES.map((s, i) => <li key={s} className={i < stage ? 'done' : i === stage ? 'on' : ''}><Icon name={i < stage ? 'check' : 'clock'} size={14} />{t('ai.stage.' + s)}</li>)}
          </ol>
          <p>{t('ai.demo.a1')}</p>
          <Card className="diff">
            <div className="diff-head"><Icon name="code" size={14} /> <code>about.html</code> <Badge tone="success">+1</Badge> <Badge tone="danger">−0</Badge></div>
            <pre><code>{'  <title>За нас · Studio North</title>\n+ <meta name="description" content="Архитектурно студио в София — проекти, екип и контакт.">'}</code></pre>
          </Card>
          <p className="muted small">{t('ai.demo.verified')}</p>
          <div className="row-actions"><Button kind="primary" icon="check">{t('ai.apply')}</Button><Button>{t('ai.discard')}</Button><span className="muted small">{t('ai.cost', { n: num(1240) })}</span></div>
        </div>
      </div>
      <div className="composer">
        <div className="context"><span className="eyebrow">{t('ai.context')}</span><span className="chip">about.html · 3 KB</span><span className="chip">work.html · 5 KB</span><span className="chip">{t('ai.redacted', { n: 1 })}</span></div>
        <div className="composer-row">
          <textarea rows={2} placeholder={t('ai.placeholder')} aria-label={t('ai.placeholder')} />
          <Button kind="primary" icon="send" onClick={() => setStage(0)}>{t('ai.send')}</Button>
        </div>
        <p className="muted small">{t('ai.estimate', { min: num(700), max: num(2600) })}</p>
      </div>
    </div>
  );
}
