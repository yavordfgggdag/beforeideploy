# Auth email templates (V10 WP1)

Supabase sends one template per email type, so each template carries both languages and picks one with
the user's `locale` from the signup / invite metadata (`{{ .Data.locale }}`, set by the engine and by the
admin `invite` action). English is the fallback.

| File | Supabase → Authentication → Email Templates | Subject |
|---|---|---|
| `confirmation.html` | Confirm signup | Confirm your email · Потвърди имейла си |
| `recovery.html` | Reset password | New password · Нова парола |
| `invite.html` | Invite user | Invitation to Before I Deploy · Покана за Before I Deploy |
| `magic_link.html` | Magic link | Your sign-in link · Линк за вход |

Paste each file into its template (or reference them from `supabase/config.toml` with
`[auth.email.template.<type>] content_path = "./supabase/email-templates/<file>.html"` when you manage the
project with the Supabase CLI). Fully localized subjects need custom SMTP (WP9, Resend).

`node tests/run.mjs` checks that every template has both languages and the confirmation link.
