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
  version: "1.6"
  test_sequence: 6
  run_ui: false

test_plan:
  current_focus:
    - "Multi-angle Try-On (backend + frontend)"
    - "Currency Localization (backend + frontend)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Iteration 6 implements (a) Multi-angle AI try-on (front/3-4/side/back) with parallel Nano Banana renders and (b) Currency localization (12 currencies, KES default for new Kenyan users, indicative FX, per-item listing currency, Stripe charges item currency).
      Please test:
      Backend:
        1) POST /api/auth/register without preferred_currency → user.preferred_currency = "KES"
        2) PATCH /api/auth/preferences {"preferred_currency":"USD"} → 200, user.preferred_currency = "USD"; bad code → 422
        3) POST /api/items (seller) without currency → item.currency = seller.preferred_currency
        4) POST /api/items with explicit currency=KES → stored
        5) POST /api/tryon with angles=["front","side","back"] → returns images list of 3 entries (each has angle + image_b64) AND result_image_b64 is the front one. Make sure the call completes (Nano Banana parallel) — allow up to 90s.
        6) GET /api/tryon/{id}/share?fmt=square&angle=side → returns a watermarked image_b64 for the side angle (200). With angle=back when only front+side exist, should gracefully fall back.
        7) GET /api/tryon/history → returns images[] populated; legacy records (single result_image_b64) should also surface as images[{angle:"front",image_b64:…}].
        8) POST /api/payments/checkout → success, order.currency matches item.currency.
      Use the existing demo credentials in /app/memory/test_credentials.md.
      Frontend (only if backend passes):
        1) Login as buyer → Profile tab → tap "REGION & CURRENCY" → list of 12 currencies appears → switch to USD then back to KES (toast shows). On Discover, the indicative price under each card should disappear when KES = listing currency, and reappear with the right symbol otherwise.
        2) On an item detail page, tap "Try It On" → single front render arrives. Tap "Multi-Angle Try-On" → 3 thumbs appear (Front/Side/Back) — tap each to swap hero. Share button shares the active angle.
        3) Seller new-item form → currency chips visible, selecting KES updates the price input label to "Price (KES)" with placeholder "12,500".
