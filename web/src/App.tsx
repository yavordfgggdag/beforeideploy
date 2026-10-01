import { useEffect, useState } from 'react';
import { Icon } from './components/Icon';
import { t, getLang, setLang, type Lang } from './i18n';
import { Overview } from './screens/Overview';
import { Sites, SiteDetail } from './screens/Sites';
import { CreateSite } from './screens/CreateSite';
import { Assistant } from './screens/Assistant';
import { Activity } from './screens/Activity';
import { PlanUsage } from './screens/PlanUsage';
import { Settings } from './screens/Settings';

export type Route = { name: 'overview' | 'sites' | 'site' | 'create' | 'assistant' | 'activity' | 'plan' | 'settings'; id?: string };
const parse = (h: string): Route => { const [name, id] = h.replace(/^#\/?/, '').split('/'); return { name: (name || 'overview') as Route['name'], id }; };
export const go = (r: Route) => { location.hash = `#/${r.name}${r.id ? '/' + r.id : ''}`; };

const NAV: { id: Route['name']; icon: string }[] = [
  { id: 'overview', icon: 'overview' }, { id: 'sites', icon: 'sites' }, { id: 'assistant', icon: 'ai' },
  { id: 'activity', icon: 'activity' }, { id: 'plan', icon: 'plan' }, { id: 'settings', icon: 'settings' },
];

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [, force] = useState(0);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => { try { return (localStorage.getItem('bid.theme') as 'light' | 'dark') || 'system'; } catch { return 'system'; } });
  useEffect(() => { const f = () => setRoute(parse(location.hash)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('bid.theme', theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => { document.getElementById('main')?.focus({ preventScroll: true }); }, [route.name, route.id]);
  const active = route.name === 'site' || route.name === 'create' ? 'sites' : route.name;
  const changeLang = (l: Lang) => { setLang(l); force((x) => x + 1); };

  return (
    <div className="shell">
      <a href="#main" className="skip">{t('a11y.skip')}</a>
      <nav className="sidebar" aria-label={t('nav.label')}>
        <div className="brand"><span className="brand-mark" aria-hidden><Icon name="rocket" size={16} /></span>Before I Deploy</div>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <a href={`#/${n.id}`} className={active === n.id ? 'nav nav-on' : 'nav'} aria-current={active === n.id ? 'page' : undefined}>
                <Icon name={n.icon} /> <span>{t('nav.' + n.id)}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          <button className="nav" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')} aria-label={t('settings.appearance')}>
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} /> <span>{t('appearance.' + theme)}</span>
          </button>
          <button className="nav" onClick={() => changeLang(getLang() === 'bg' ? 'en' : 'bg')}><Icon name="globe" /> <span>{getLang() === 'bg' ? 'English' : 'Български'}</span></button>
        </div>
      </nav>
      <main id="main" tabIndex={-1} className="main">
        {route.name === 'overview' && <Overview />}
        {route.name === 'sites' && <Sites />}
        {route.name === 'site' && <SiteDetail id={route.id!} />}
        {route.name === 'create' && <CreateSite />}
        {route.name === 'assistant' && <Assistant />}
        {route.name === 'activity' && <Activity />}
        {route.name === 'plan' && <PlanUsage />}
        {route.name === 'settings' && <Settings theme={theme} onTheme={setTheme} onLang={changeLang} />}
      </main>
    </div>
  );
}
