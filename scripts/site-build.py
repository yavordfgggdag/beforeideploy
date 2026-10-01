# Builds the static site pages with one shared header and footer: python3 scripts/site-build.py
import pathlib
import json
HERE = pathlib.Path(__file__).parent.parent / "site"
SELLER = "[Seller legal name]"          # fill before Paddle review: your legal name or company
ADDRESS = "[Registered address]"         # fill before Paddle review
SUPPORT = "support@beforeideploy.app"    # change if the domain differs
UPDATED = "1 October 2026"
CATALOG = json.loads((HERE.parent / "supabase/functions/_shared/plans-catalog.json").read_text())
# Catalog v13: "connected hosting" prices are on sale until features.hostingIncluded is switched on; then the
# hosting-included V3 prices (each plan's `hostingIncluded` block) are shown instead.
INCLUDED = CATALOG.get('features', {}).get('hostingIncluded') is True
def sold(plan):
    return plan['hostingIncluded'] if INCLUDED and plan.get('hostingIncluded') else plan
def netlify(plan):
    h = plan.get('hosting') or {}
    tier = f'Netlify {h.get("tier", "").title()} ({h.get("credits", 0):,} credits)'
    return f'{tier} included' if INCLUDED else f'Recommended hosting: {tier}, billed by Netlify to your own team'
FREE = CATALOG.get('free') or {'credits': 0, 'activeSites': 1}
FREE_CARD = f'<div class="card"><h3>Free</h3><div class="price">€0</div><ul><li>{FREE["credits"]:,} AI credits a month</li><li>{FREE["activeSites"]} active site</li><li>All checks, deploys, Local Preview, Git and Mission Control</li><li>Hosting on your own free Netlify account</li></ul></div>'
PLAN_CARDS = ''.join(f'<div class="card"><h3>{name.title()}</h3><div class="price">€{sold(plan)["price"]:.2f} <small>/ month</small></div><ul><li>{plan["credits"]:,} AI credits a month</li><li>{plan["activeSites"]} active site(s)</li><li>{plan.get("cloudMinutes", 0):,} cloud minutes a month</li><li>Unused credits stay valid {plan["validityMonths"]} month(s)</li><li>{netlify(plan)}</li><li>€{sold(plan)["yearly"]["price"]:.2f} a year</li></ul></div>' for name,plan in CATALOG['plans'].items())
BONUS = (CATALOG.get('starterBonus') or {}).get('credits', 0)
PACK_PRICES = ', '.join(f'{pack["tokens"]:,} for €{pack["price"]:.2f}' for pack in CATALOG['packs'])
DRAFT = '<p class="draft">Draft — the seller details in brackets are completed before sales start.</p>'

def page(name, title, body, desc="Check, fix and publish your websites from one Mac app."):
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><div class="wrap">
  <span class="logo" aria-hidden="true"></span><a class="brand" href="/">Before I Deploy</a>
  <nav><a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="mailto:{SUPPORT}">Support</a></nav>
</div></header>
<main class="wrap">
{body}
</main>
<footer><div class="wrap">
  <span>© 2026 {SELLER}</span>
  <a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refund">Refund policy</a>
  <a href="mailto:{SUPPORT}">{SUPPORT}</a>
  <span>Payments are processed by Paddle.com, our Merchant of Record.</span>
</div></footer>
</body>
</html>
"""
    (HERE / f"{name}.html").write_text(html, encoding="utf-8")

page("index", "Before I Deploy — check before you publish", f"""
<section class="hero">
  <h1>Know it works<br>before you deploy.</h1>
  <p>Before I Deploy checks your website the way a careful senior developer would — Git, secrets,
  dependencies, lint, types, build and hosting — explains what is wrong in plain words, proposes the fix,
  and only then publishes.</p>
  <a class="btn" href="mailto:{SUPPORT}?subject=Before%20I%20Deploy%20beta">Join the beta</a>
  <a class="btn ghost" href="#pricing">See pricing</a>
  <p class="note">For macOS 13 or newer · Apple silicon and Intel · English and Bulgarian</p>
  <img class="shot" src="/mission-control.png" alt="Mission Control: every project with its status, uptime and SSL">
</section>
<section id="features">
  <h2>Everything before “deploy”, in one window</h2>
  <div class="grid">
    <div class="card"><h3>One-click check</h3><p>Git, secrets, dependencies, lint, typecheck, build and hosting. Unchanged steps are reused, so the second check takes seconds.</p></div>
    <div class="card"><h3>Automatic check</h3><p>Watches your project while you work and tells you only when the verdict changes.</p></div>
    <div class="card"><h3>AI Fix</h3><p>Explains the failure and proposes the changes as a diff. Nothing is written until you apply it.</p></div>
    <div class="card"><h3>Safe publishing</h3><p>Draft first, production only after typing DEPLOY and a fresh check of exactly the code on disk. Netlify, Vercel, Cloudflare Pages, GitHub Pages.</p></div>
    <div class="card"><h3>Mission Control</h3><p>All your sites at a glance: status, uptime, SSL expiry, domains and costs.</p></div>
    <div class="card"><h3>Private by design</h3><p>Hosting and AI keys stay in your Mac's Keychain. Your code is never uploaded, except what you choose to send to AI Fix.</p></div>
  </div>
</section>
<section id="pricing">
  <h2>Pricing</h2>
  <div class="grid four">
    {FREE_CARD}
    {PLAN_CARDS}
  </div>
  <p class="note">Each month's AI credits are released gradually over 14 days, so a month's budget cannot run out in
  the first days. New customers get a one-time starter bonus of {BONUS:,} credits for creating their first site.
  Active sites, monitoring and backups are part of the plan and never use AI credits.</p>
  <p class="note">Extra credits: {PACK_PRICES}, valid 12 months, usable at any time. Prices include VAT where it applies.
  Cancel any time; see the <a href="/refund">refund policy</a>.</p>
</section>
""")

page("privacy", "Privacy — Before I Deploy", f"""
<article class="legal">
<h1>Privacy policy</h1><p class="updated">Last updated {UPDATED}</p>
{DRAFT}
<p>This policy explains what Before I Deploy (“the app”), provided by {SELLER}, {ADDRESS} (“we”), does with
personal data. Questions: <a href="mailto:{SUPPORT}">{SUPPORT}</a>.</p>
<h2>1. Without an account</h2>
<p>The app works locally. Your projects, check results, history and logs stay on your Mac. Keys for hosting
providers and AI providers are stored in the macOS Keychain. We receive nothing, except that the app asks
our update server whether a new version exists (your IP address is seen by that server for this request).</p>
<h2>2. With an account</h2>
<p>If you create an account we store: your e-mail address and display name; your role, plan and language;
for each project you add — its name, framework, hosting provider, live URL, domain and the result of the
last check; your AI usage (time, step, model, token count, project name); your subscription and token
balance. We never store your source code or your keys.</p>
<h2>3. AI Fix</h2>
<p>Only when you start AI Fix, and after you agree once, the log of the failed step (with keys and
passwords removed) and the project files it names are sent to the AI model: to Anthropic through our
service, or directly to the provider of your own key. Anthropic processes this data to answer and does
not use it to train models under its commercial terms.</p>
<h2>4. Payments</h2>
<p>Paddle.com is the Merchant of Record for all purchases. Paddle collects your payment details, billing
address and tax information under its own privacy policy; we receive the subscription status and what you
bought, not your card details.</p>
<h2>5. Processors</h2>
<p>Supabase (database and authentication), Paddle (payments), Anthropic (AI Fix), and our e-mail
provider for sign-in and invitation e-mails. Each processes data only on our instructions.</p>
<h2>6. Legal basis and retention</h2>
<p>We process account data to provide the service you asked for (contract) and payment records to meet tax
law (legal obligation). Account data is kept while the account exists; deleting the account removes it,
except payment records we must keep by law. A one-way hash of your e-mail is kept to allow one free trial
per address.</p>
<h2>7. Your rights</h2>
<p>In the app, Settings → Account lets you export all your data or delete your account at any time. You may
also ask us for access, correction, deletion, restriction or portability, object to processing, and
complain to your data protection authority.</p>
<h2>8. Changes</h2>
<p>We will announce material changes in the app before they take effect.</p>
</article>
""", "How Before I Deploy handles your data.")

page("terms", "Terms — Before I Deploy", f"""
<article class="legal">
<h1>Terms of service</h1><p class="updated">Last updated {UPDATED}</p>
{DRAFT}
<p>These terms are an agreement between you and {SELLER}, {ADDRESS} (“we”), for the use of Before I Deploy
(“the app”) and its optional cloud service.</p>
<h2>1. The app</h2>
<p>You may install and use the app on Macs you own or control. The app checks, builds and publishes
projects on your instruction; you remain responsible for your code, your hosting accounts and what you
publish. Production deploys only happen after you confirm them.</p>
<h2>2. Account</h2>
<p>An account is optional. Keep your sign-in details safe and tell us about any misuse. You must be at least
16 years old, or have a guardian's consent.</p>
<h2>3. Plans and payment</h2>
<p>Paid plans (Flash, High, Knight) are subscriptions billed monthly or yearly in advance and renew until
cancelled. Each month's included credits are released gradually over 14 days. Credits from each plan payment
remain valid for 1 month (Flash), 3 months (High), or 10 months (Knight); accumulation is capped at monthly credits
multiplied by validity. Credits are spent in this order: starter bonus, older plan credits (oldest first), this
month's credits, then credit packs. Credit packs are valid for 12 months. Our order process is conducted by our online reseller Paddle.com, which is
the Merchant of Record for all our orders; Paddle provides customer service inquiries and handles returns.
Prices are shown in the app and on this site and include VAT where it applies.</p>
<h2>4. Trial</h2>
<p>New users may start one free 7-day High trial per e-mail address, without payment details. It ends by
itself.</p>
<h2>5. Cancellation and refunds</h2>
<p>Cancel any time in the app (Plans → Manage subscription); the plan stays active until the end of the paid
period. Refunds follow our <a href="/refund">refund policy</a>.</p>
<h2>6. Fair use</h2>
<p>Do not abuse the AI service (automated mass requests, reselling, attacks) or use the app to publish
unlawful content. We may limit or suspend accounts that do.</p>
<h2>7. AI output</h2>
<p>AI suggestions can be wrong. Review proposed changes before applying them and run the check again.</p>
<h2>8. Liability</h2>
<p>The app is provided with reasonable care, but we are not liable for indirect damages, lost profits or data
loss caused by deploys you confirmed, to the extent the law allows. Nothing here limits rights consumers
have by law.</p>
<h2>9. Changes and law</h2>
<p>We will announce material changes in the app in advance. These terms are governed by the laws of the
seller's country of registration, without removing protections of your own country's consumer law.</p>
<h2>10. Contact</h2>
<p><a href="mailto:{SUPPORT}">{SUPPORT}</a></p>
</article>
""", "Terms of service for Before I Deploy.")

page("refund", "Refund policy — Before I Deploy", f"""
<article class="legal">
<h1>Refund policy</h1><p class="updated">Last updated {UPDATED}</p>
{DRAFT}
<p>We want you to be happy with Before I Deploy.</p>
<h2>14-day refund</h2>
<p>You can ask for a full refund of any purchase — subscription or token pack — within 14 days of the
payment, for any reason. Write to <a href="mailto:{SUPPORT}">{SUPPORT}</a> or reply to your Paddle receipt,
or use the Paddle link in that receipt.</p>
<h2>What happens after a refund</h2>
<p>The unused credits of that purchase are removed; for a partial refund, the matching share. A refunded
subscription ends.</p>
<h2>After 14 days</h2>
<p>You can cancel any time; the plan stays active until the end of the period you paid for and does not
renew. Partial periods are not refunded, unless the law of your country requires it.</p>
<h2>Who processes refunds</h2>
<p>Paddle.com is our Merchant of Record and processes all refunds to your original payment method.</p>
</article>
""", "Refund policy for Before I Deploy.")

page("404", "Not found — Before I Deploy", """
<section class="hero"><h1>Page not found</h1><p><a href="/">Back to the start</a></p></section>
""")
print("pages written")
