#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Continue developing AuraFit (AI virtual try-on clothing app). Two enhancements this iteration:
  1) Enhanced AI try-on with multi-angle previews (front + side + back), and
  2) Currency localization — user is in Kenya, so support KES + other currencies.


  - task: "Backend refactor — split server.py into core/* + models.py + routers/* modules"
    implemented: true
    working: true
    file: "/app/backend/server.py + /app/backend/core/* + /app/backend/models.py + /app/backend/routers/*"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: |
          Server.py shrunk from 1784 → 80 lines (just FastAPI app, CORS, lifecycle, router includes). Extracted:
          • core/config.py (env vars, constants)
          • core/db.py (Mongo client singleton)
          • core/security.py (bcrypt, JWT, get_current_user, require_role, try_get_user_from_creds)
          • core/images.py (strip_data_prefix, watermark_image)
          • models.py (every Pydantic schema + user_to_out, item_to_out, collection_to_out, total_qty)
          • routers/{auth,profile,items,wishlist,tryon,orders,payments,seller,collections}.py — each owns one APIRouter()
          Route-ordering invariants preserved (/items/mine before /items/{id}, /collections/mine before /collections/{id}, /tryon/history before /tryon/{id}/share).
          Verified via 15 curl smoke tests (auth/me, items, items/mine, feed, collections, wishlist, orders, tryon/history, seller/analytics, seller/connect/status, prefs PATCH valid + 422, profile). All 200/expected. Backend lint: 0 issues. No behavioural change; legacy try-ons (single result_image_b64) still surface as images=[{angle:'front',...}].
backend:
  - task: "Currency Localization — per-item currency, user.preferred_currency (default KES), Stripe charges item currency, PATCH /api/auth/preferences"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added Currency literal (USD/KES/EUR/GBP/NGN/ZAR/INR/UGX/TZS/RWF/GHS/EGP), DEFAULT_CURRENCY='KES'. Items now carry currency (defaults to seller.preferred_currency at create time). Users carry preferred_currency (defaults to KES on register if not provided). Orders carry currency. Stripe checkout now passes the item's currency (lowercased). New PATCH /api/auth/preferences endpoint validates the literal and updates user.preferred_currency. UserOut + OrderOut return currency."
      - working: false
        agent: "testing"
        comment: "Testing agent confirmed 15/16 cases pass. ONE bug: items created without explicit currency stored 'KES' instead of seller's preferred_currency because ItemIn.currency had a non-None default."
      - working: true
        agent: "main"
        comment: "Fixed by changing ItemIn.currency to Optional[Currency] = None so the seller-pref fallback in create_item now fires. Re-verified via curl: seller pref USD → item.currency=USD; seller pref KES → item.currency=KES."

  - task: "Multi-angle Try-On — TryOnIn accepts angles list, parallel Gemini Nano Banana generations, response carries images:[{angle,image_b64}]"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added TryOnAngle type, ANGLE_INSTRUCTIONS prompt map, _generate_single_angle helper, asyncio.gather parallel generation. /api/tryon now accepts angles[] (max 4, default ['front']). /api/tryon/history returns images[]. /api/tryon/{id}/share accepts ?angle=front|three_quarter|side|back. Backward compat: result_image_b64 still populated (first angle). Legacy single-angle records still play back via /history."
      - working: true
        agent: "testing"
        comment: "Verified end-to-end: 3 angles render in ~10s via Nano Banana, result_image_b64 == front image, /history returns images[] for both new and legacy try-ons, /share?angle=side returns 200, fallback works when requested angle is missing."

frontend:
  - task: "Multi-angle UI in Item Detail — Try It On (front) and Multi-Angle Try-On (front+side+back) buttons; thumbnail strip; share active angle"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/item/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "runTryOn(angles) now drives both single & multi-angle flows. UI shows ActivityIndicator with copy 'Rendering 3 angles…' during multi. Thumb strip with testID item-angle-{front|side|back} when >1 image returned. Share button now shares activeAngle. Reset button clears all angles."

  - task: "Currency display everywhere via formatPrice/indicativePrice; profile picker; new-item currency chip selector"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/lib/currency.ts, /app/frontend/app/(tabs)/profile.tsx, /app/frontend/app/seller/new-item.tsx, /app/frontend/app/(tabs)/index.tsx, /app/frontend/app/item/[id].tsx, /app/frontend/app/checkout/result.tsx, /app/frontend/app/collection/[id].tsx, /app/frontend/app/(tabs)/atelier.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New currency.ts with 12 currencies (KSh, $, €, £, ₦, R, ₹, USh, TSh, RF, GH₵, E£), formatPrice handles decimals=0/2, indicativePrice gives ≈ conversion when buyer's preferred currency differs from listing. Profile screen has expandable Region & Currency card with testID profile-currency-{CODE}. Seller new-item has chip-row currency selector defaulting to seller's preferred currency. All price strings replaced. Verified via screenshots: Discover cards show '$ 169.00' with '≈ KSh 21,886' below; Profile shows current KES + opens picker with all 12 options."

metadata:
  created_by: "main_agent"
  version: "1.7"
  test_sequence: 7
  run_ui: false

test_plan:
  current_focus:
    - "Seller registration overhaul (frontend) — Company/Location/Bank/M-Pesa instead of age/gender/DOB"
    - "Admin role + admin dashboard (backend + frontend)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

backend:
  - task: "Seller registration schema — drop age/gender/DOB, require company_name + location, accept optional bank_details (incl. M-Pesa)"
    implemented: true
    working: true
    file: "/app/backend/routers/auth.py, /app/backend/models.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          RegisterIn now carries company_name / location (Location) / bank_details (BankDetails) and the
          register handler enforces company_name + location.{city,country} for role=seller while
          rejecting demographics. role=admin POSTs are 403'd — admins can only come from seed.py.
          UserOut surfaces company_name / location / bank_details / suspended so the frontend can render
          the seller profile correctly. Admin endpoints (/api/admin/users, /api/admin/users/{id} PATCH,
          /api/admin/orders, /api/admin/items, /api/admin/items/{id} DELETE, /api/admin/analytics) are
          gated by require_admin().

  - task: "Admin endpoints — analytics, user list/get/patch (suspend / restore / unlock connect), order list, item list/delete"
    implemented: true
    working: true
    file: "/app/backend/routers/admin.py, /app/backend/seed.py, /app/backend/core/security.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Seed script now also creates admin@drape.app / drape-admin-2026 idempotently and back-fills
          the demo seller with company_name / location / bank_details. require_admin() raises 403 for
          buyers / sellers. /api/admin/analytics aggregates total_users (by role + suspended),
          total_items / total_orders / total_paid_orders, gross revenue + platform fee + net to sellers,
          pending_connect_sellers, top 5 sellers by paid revenue. /api/admin/items returns every
          listing; DELETE /api/admin/items/{id} removes the item and cleans up dependent wishlist rows.

frontend:
  - task: "Register screen splits Buyer vs Seller fields — buyers keep gender + DOB; sellers fill Company/Brand, City/Country, optional Bank + M-Pesa"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(auth)/register.tsx, /app/frontend/src/lib/api.ts, /app/frontend/src/lib/auth.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Selecting the Seller role swaps the Gender + DOB block for an Atelier section (Company name,
          City, Country) followed by a Payouts section (Bank name / Account name / Account number /
          M-Pesa Paybill / Till). useAuth() now exposes registerBuyer and registerSeller helpers that
          send the matching schema. Verified manually via Playwright: brand-new seller account
          (newseller…@drape.demo) registered without 422; landed on Discover with role=seller; Atelier
          tab visible. Backend /api/auth/register went 200 once the frontend payload matched the schema.
      - working: "NA"
        agent: "main"
        comment: |
          Updated /app/(tabs)/profile.tsx: when role=seller, header shows company name + location;
          Body Profile block is buyer-only; a new "Payout details" section renders bank / account
          (masked) / M-Pesa Paybill / Till when present, else an empty-state nudge.

  - task: "Admin dashboard — /admin (analytics), /admin/users (search + suspend), /admin/items (delete), /admin/orders (filter by status); shared AdminShell with bottom nav + sign out"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/admin/_layout.tsx, /app/frontend/app/admin/index.tsx, /app/frontend/app/admin/users.tsx, /app/frontend/app/admin/items.tsx, /app/frontend/app/admin/orders.tsx, /app/frontend/src/components/AdminShell.tsx, /app/frontend/app/index.tsx, /app/frontend/app/(auth)/login.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Index redirect + login redirect now route role=admin to /admin instead of /(tabs).
          AdminShell provides editorial header + bottom tab bar (Dashboard / Users / Items / Orders) +
          sign-out. Dashboard surfaces 4 tile cards (Members, Suspended, Listings, Orders), a hero
          revenue panel (gross / platform fees / net to sellers) and a Top 5 sellers list — all in the
          admin's preferred currency. Users screen supports search-by-name/email/company, role filters
          (All / Buyers / Sellers / Admins), and Suspend / Restore toggle (admins can't be modified).
          Items screen lists every listing with a confirm-and-delete bin (Alert.alert native, confirm()
          on web). Orders screen filters by status (All / Paid / Pending / Failed / Cancelled). Each
          screen guards against non-admin viewers by replacing to /(auth)/welcome on focus.
          Manual Playwright check: admin@drape.app login lands on /admin with 16 members / 13 buyers /
          2 sellers / 1 admin / 9 orders / 4 paid; Top sellers = Maison Lumière 4 orders. Users tab
          shows seed admin (cannot modify) + suspend buttons for buyers/sellers. Items tab lists all 8
          seeded items with delete icons. Orders tab shows all 9 historical orders with green PAID
          pills.

agent_communication:
  - agent: "main"
    message: |
      Iteration 7 implements the "Seller signup overhaul + Admin role" feature.
      Test credentials (in /app/memory/test_credentials.md):
        - admin@drape.app / drape-admin-2026   (admin)
        - atelier@aurafit.demo / demo-seller-2026  (seller — now has company/location/bank)
        - buyer@aurafit.demo / demo-buyer-2026 (buyer)
      Please test:
      Backend:
        1) POST /api/auth/register with role=seller + {company_name, location, bank_details} → 200, returns user with company_name + location populated.
        2) POST /api/auth/register with role=seller missing company_name → 400 "Company name is required for sellers".
        3) POST /api/auth/register with role=seller missing location → 400 "Location (city, country) is required for sellers".
        4) POST /api/auth/register with role=seller passing age/dob → server should ignore them (resolved_age None, dob None).
        5) POST /api/auth/register with role=admin → 403 "Admin accounts cannot be self-registered".
        6) POST /api/auth/login as admin@drape.app/drape-admin-2026 → 200, user.role=admin.
        7) GET /api/admin/analytics as admin → 200, returns counts + revenue + top_sellers; same call as a buyer → 403.
        8) GET /api/admin/users?role=seller → list of sellers (UserOut shape with company_name + location).
        9) PATCH /api/admin/users/{id} {suspended:true} as admin → user.suspended=true; tried as seller → 403.
        10) GET /api/admin/items → all items; DELETE /api/admin/items/{id} as admin → 200; corresponding wishlist rows cleared.
      Frontend (only if backend passes):
        1) Welcome → CREATE ACCOUNT → tap Seller chip → form should now show Atelier section (Company, City, Country) + Payouts section (Bank/M-Pesa) and NO gender/DOB inputs.
        2) Fill Company "Test Co", City "Nairobi", Country "Kenya", submit → registers successfully and lands on /(tabs)/index.
        3) Welcome → SIGN IN as admin@drape.app/drape-admin-2026 → lands on /admin → 4 metric tiles visible + Top sellers + bottom Dashboard/Users/Items/Orders tabs.
        4) Tap Users → search "atelier" → finds Maison Lumière; toggle SUSPEND then RESTORE.
        5) Tap Items → delete icon on any item → confirmation → item disappears (do not actually delete seeded items unless you re-seed afterwards).
        6) Tap Orders → switch between PAID/PENDING filters → list updates.
