---
name: Pulse Architecture
description: Key decisions and conventions for the Pulse dating app build.
---

## Auth pattern
- Frontend has NO direct Supabase client. All auth via Express: POST /api/auth/signup, POST /api/auth/login.
- Token stored in localStorage('pulse_token'). `setAuthTokenGetter` from `@workspace/api-client-react` injects it as Bearer on every generated hook call.
- Backend validates token via `supabase.auth.getUser(token)` (service-role client).

## Database
- Supabase Postgres. Schema in `supabase_schema.sql` at project root — user must run this manually in Supabase SQL Editor.
- Backend uses `@supabase/supabase-js` admin client (service-role key, bypasses RLS).
- No Drizzle — DATABASE_URL points to Replit's built-in Postgres, not Supabase.

## Tailwind v4 dark mode
- `@apply dark` is invalid in Tailwind v4 (dark is a variant, not a utility class).
- Force dark mode by adding `class="dark"` to `<html>` in index.html.
- CSS uses `@custom-variant dark (&:is(.dark *))` and `:root, .dark {}` block.

## Generated API hooks
- All data calls use Orval-generated hooks from `@workspace/api-client-react`.
- Auth routes (/api/auth/*) are NOT in the OpenAPI spec — use raw fetch for those.
- `useToast` lives at `@/hooks/use-toast`, NOT `@/components/ui/use-toast`.

**Why:** Design subagent imported from the wrong path; future agents should note the correct location.
