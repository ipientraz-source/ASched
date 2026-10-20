// Edge function: Super-admin membuat / mengganti password akun login Captain & Super-admin.
// Service role key hanya ada di sini (server). Deploy: npx supabase functions deploy kelola-admin
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user } } = await caller.auth.getUser()
  if (!user?.email) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: me } = await admin.from('riders').select('peran,status').eq('email', user.email.toLowerCase()).maybeSingle()
  if (me?.peran !== 'super_admin' || me.status !== 'aktif') return json({ error: 'Hanya Super-admin' }, 403)

  const { email, password } = await req.json().catch(() => ({}))
  if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8)
    return json({ error: 'Email dan password (min 8 karakter) wajib' }, 400)
  const e = email.trim().toLowerCase()

  // Hanya email yang sudah terdaftar sebagai Captain / Super-admin yang boleh dibuatkan akun
  const { data: target } = await admin.from('riders').select('peran').eq('email', e).maybeSingle()
  if (!target || target.peran === 'rider') return json({ error: 'Email belum terdaftar sebagai Captain/Super-admin' }, 400)

  const { error } = await admin.auth.admin.createUser({ email: e, password, email_confirm: true })
  if (!error) return json({ ok: true, created: true })

  // Sudah ada → ganti password
  for (let page = 1; ; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    const u = data?.users.find((x) => x.email?.toLowerCase() === e)
    if (u) {
      const r = await admin.auth.admin.updateUserById(u.id, { password })
      return r.error ? json({ error: r.error.message }, 400) : json({ ok: true, created: false })
    }
    if (!data || data.users.length < 1000) break
  }
  return json({ error: error.message }, 400)
})
