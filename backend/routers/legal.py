"""Public legal + marketing pages served as plain HTML:

  GET /api/legal/privacy         — privacy policy URL for Play/App Store.
  GET /api/legal/delete-account  — Google Play "account & data deletion" URL.
                                   Lets a user delete their Oromona account
                                   from the web (email + password → calls the
                                   same self-service deletion the app uses).
  GET /api/landing               — oromona.com landing page (mobile + desktop)
                                   with placeholder App Store / Google Play
                                   buttons and links to Privacy + Delete Data.

No authentication on the pages themselves; the deletion form authenticates
through the existing /api/auth/login + DELETE /api/auth/me endpoints, so no
new deletion logic exists here.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

_STYLE = """
  body { font-family: 'Georgia', serif; background: #F5F1EA; color: #14110E;
         margin: 0; padding: 32px 20px; line-height: 1.65; }
  .card { max-width: 720px; margin: 0 auto; background: #fff; padding: 40px 32px;
          border: 1px solid #E4DCD0; }
  h1 { font-size: 30px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 28px 0 8px; }
  .kicker { font-family: Arial, sans-serif; font-size: 11px; letter-spacing: 3px;
            color: #C86B4A; text-transform: uppercase; }
  p, li { font-size: 15px; } .muted { color: #6B6157; font-size: 13px; }
  input { width: 100%; box-sizing: border-box; padding: 12px; margin: 6px 0 14px;
          border: 1px solid #C9BFB1; font-size: 15px; background: #FAF7F2; }
  button { background: #B3261E; color: #fff; border: 0; padding: 14px 22px;
           font-size: 14px; letter-spacing: 1px; cursor: pointer; width: 100%; }
  .ok { color: #1E7B34; } .err { color: #B3261E; }
  a { color: #C86B4A; }
"""

_PRIVACY_HTML = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oromona — Privacy Policy</title><style>{_STYLE}</style></head>
<body><div class="card">
  <div class="kicker">Oromona</div>
  <h1>Privacy Policy</h1>
  <p class="muted">Last updated: June 2026</p>

  <p>Oromona ("we", "us") is a fashion marketplace app for buyers, sellers and
  delivery riders. This policy explains what we collect, why, and the choices
  you have.</p>

  <h2>1. Information we collect</h2>
  <ul>
    <li><b>Account details</b> — name, email, password (stored as a salted hash),
      role (buyer / seller / rider), and for sellers a business name and location.</li>
    <li><b>Fit &amp; styling data (optional)</b> — body measurements, preferred size and,
      if you choose to add them, full-body photos used for AI try-on and AI stylist
      recommendations.</li>
    <li><b>Listings &amp; orders</b> — product photos and details you list, purchases,
      delivery addresses and phone numbers you provide at checkout.</li>
    <li><b>Payments</b> — processed by <b>Paystack</b>; we never see or store your full
      card or mobile-money credentials, only payment references and status.</li>
  </ul>

  <h2>2. How we use it</h2>
  <ul>
    <li>To run the marketplace: listings, checkout, delivery and escrow protection.</li>
    <li>To generate AI try-on images and stylist suggestions from the photos and
      measurements you provide. Photos are sent to Google's Gemini models for
      generation and are not used to train our own models.</li>
    <li>To send transactional email (e.g. password reset) via <b>Resend</b>.</li>
  </ul>

  <h2>3. Sharing</h2>
  <p>We share data only with the processors needed to operate the app: Paystack
  (payments), Resend (email), Google Gemini via our AI provider (image/styling
  generation), and our cloud database host. Sellers see only what is needed to
  fulfil your order (name, delivery address, phone). Riders see pickup/delivery
  contact details for an active job. We do not sell personal data.</p>

  <h2>4. Retention</h2>
  <p>Account data is kept while your account is active. Order and payout records
  are retained as required for bookkeeping and legal compliance even after
  account deletion.</p>

  <h2>5. Deleting your account &amp; data</h2>
  <p>You can permanently delete your account and personal data at any time:</p>
  <ul>
    <li><b>In the app</b>: Profile → Delete Account.</li>
    <li><b>On the web</b>: <a href="/api/legal/delete-account">our account deletion page</a>.</li>
  </ul>
  <p>Deletion removes your profile, photos, measurements, addresses, try-ons,
  stylist chats and wishlists, and permanently disables the login. Financial
  order records are retained (without a usable login) for legal reasons.</p>

  <h2>6. Contact</h2>
  <p>Questions or requests: <a href="mailto:support@oromona.com">support@oromona.com</a></p>
</div></body></html>"""

_DELETE_HTML = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oromona — Delete your account</title><style>{_STYLE}</style></head>
<body><div class="card">
  <div class="kicker">Oromona</div>
  <h1>Delete your account &amp; data</h1>
  <p>This permanently deletes your Oromona account: profile, photos,
  measurements, addresses, AI try-ons, stylist chats and wishlists. The login
  is destroyed and cannot be recovered. Order/payment records are retained for
  legal bookkeeping only. You can also do this in the app under
  <b>Profile → Delete Account</b>.</p>

  <h2>Delete now</h2>
  <label>Account email</label>
  <input id="email" type="email" autocomplete="email" placeholder="you@example.com">
  <label>Password</label>
  <input id="password" type="password" autocomplete="current-password" placeholder="Your password">
  <button onclick="doDelete()">Permanently delete my account</button>
  <p id="msg"></p>
  <p class="muted">Forgot your password? Reset it from the app's sign-in screen
  first, then return here. Admin accounts cannot self-delete.</p>

<script>
async function doDelete() {{
  const msg = document.getElementById('msg');
  msg.textContent = 'Working…'; msg.className = '';
  if (!confirm('This permanently deletes your account and personal data. Continue?')) {{
    msg.textContent = ''; return;
  }}
  try {{
    const login = await fetch('/api/auth/login', {{
      method: 'POST', headers: {{'Content-Type': 'application/json'}},
      body: JSON.stringify({{
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
      }}),
    }});
    if (!login.ok) {{ msg.textContent = 'Sign-in failed — check your email and password.'; msg.className = 'err'; return; }}
    const {{ token }} = await login.json();
    const del = await fetch('/api/auth/me', {{
      method: 'DELETE', headers: {{ Authorization: 'Bearer ' + token }},
    }});
    if (del.ok) {{
      msg.textContent = 'Your account and personal data have been permanently deleted.';
      msg.className = 'ok';
    }} else {{
      const d = await del.json().catch(() => ({{}}));
      msg.textContent = d.detail || 'Deletion failed — contact support@oromona.com';
      msg.className = 'err';
    }}
  }} catch (e) {{
    msg.textContent = 'Network error — please try again.'; msg.className = 'err';
  }}
}}
</script>
</div></body></html>"""


@router.get("/legal/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_policy() -> str:
    return _PRIVACY_HTML


@router.get("/legal/delete-account", response_class=HTMLResponse, include_in_schema=False)
async def delete_account_page() -> str:
    return _DELETE_HTML


# ---------------------------------------------------------------------------
# oromona.com landing page — mobile + desktop friendly, self-contained (no
# external CSS/JS). App Store / Google Play links are placeholders that
# gracefully do nothing (`#`) until the user provides the real store URLs.
# The user can either link oromona.com → https://<backend>/api/landing OR
# host the standalone HTML that ships at /app/oromona_landing.html on any
# static host (Netlify, Vercel, S3, cPanel, …). Both files are kept in
# sync via `_render_landing`.
# ---------------------------------------------------------------------------
import os as _os

_LANDING_TEMPLATE_PATH = _os.path.join(_os.path.dirname(__file__), "_landing_template.html")


def _render_landing(
    appstore_url: str = "#",
    play_url: str = "#",
) -> str:
    with open(_LANDING_TEMPLATE_PATH, "r", encoding="utf-8") as fh:
        html = fh.read()
    return html.replace("__APPSTORE_URL__", appstore_url).replace("__PLAY_URL__", play_url)


@router.get("/landing", response_class=HTMLResponse, include_in_schema=False)
async def landing() -> str:
    # Placeholder store links today — user will swap them out at launch.
    return _render_landing(appstore_url="#", play_url="#")
