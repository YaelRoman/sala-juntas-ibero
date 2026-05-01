# Calendar Dashboard Redesign — Full Implementation Spec

## Overview
Redesign the calendar interface to allow intuitive multi-step booking: monthly view → select day → weekly view (with availability) → select hours → reservation modal with optional AI text parsing.

---

## Database Model

### Reservations Table (no schema change)
Use existing `reservations` table. For multi-interval bookings (e.g., 9–11am AND 1–3pm same day):
- Create **one reservation row per interval**
- All rows share same `responsible_id`, `area`, `observations`, `created_by`
- Assign same `grouped_id` UUID if you need to track them as a logical unit (optional for now)

**Example:** User books 9–11am + 1–3pm on May 5
```
INSERT INTO reservations (responsible_id, area, start_time, end_time, observations, grouped_id, ...)
VALUES 
  (user-123, 'Sala A', '2026-05-05 09:00 UTC', '2026-05-05 11:00 UTC', 'Team sync', 'group-abc', ...),
  (user-123, 'Sala A', '2026-05-05 13:00 UTC', '2026-05-05 15:00 UTC', 'Team sync', 'group-abc', ...);
```

**Rationale:**
- Existing availability queries (index on `start_time`) work unchanged
- Calendar view shows all occupied slots correctly
- Simple to implement; add `grouped_id` only if users need to edit individual intervals separately
- If deleting, query by `grouped_id` and delete all related rows

---

## UI/UX Flow

### 1. Monthly View
**Current state:** Calendar showing all reservations  
**User action:** Click on any day cell  
**Result:**
- Transition to weekly view
- Week containing that day is displayed
- Selected day is visually highlighted (bold border or background)
- Header shows date range: "Mon May 5 – Sun May 11, 2026"

---

### 2. Weekly View
**Entry point:** From monthly view (selected day is highlighted)  
**Layout:** 7-column grid (Mon–Sun) × hourly time slots (24h or business hours)

**Availability display:**
- Query backend for all reservations on that week
- Occupied slots (existing reservations) = gray/blocked, non-clickable
- Available slots = white/clickable
- Optional: Show reservation owner/description on hover

**Navigation:**
- Left/Right arrows to move between weeks
- Clicking week navigation stays in weekly view (no back to monthly unless user explicitly exits)

**Hour selection:**
- **Single click on available hour cell** → Select that 1-hour slot; cell highlights (e.g., light blue)
- **Drag across consecutive cells** → Select continuous block (9am–11am); all selected highlight
- **Ctrl/Cmd + click non-adjacent cells** → Add to selection (multi-select mode); visual indicator (different shade/outline)
- **Display text:** Show "2 hours selected: 9am–11am, 1pm–3pm" or similar above grid
- **Clear selection button:** Button to deselect all

**Trigger reservation modal:**
- Click "Book Selected Hours" button, or
- Double-click final selected hour cell

---

### 3. Reservation Window (Modal/Overlay)
**Trigger:** User clicks/drags on available hours in weekly view  
**Behavior:**
- Opens as modal overlay on same screen (no page navigation)
- Backdrop darkens calendar behind
- Modal positioned center or top-right (~500px wide, responsive)
- Close with X button or ESC key

**Content structure (top to bottom):**

#### 3.1 Header
- Title: "New Reservation"
- Close button (X)

#### 3.2 Selected Hours Display (read-only)
```
Selected: Monday, May 5, 2026
• 9:00 AM – 11:00 AM
• 1:00 PM – 3:00 PM
```

#### 3.3 AI Text Assistant Toggle
- Checkbox/switch: "Use AI to auto-fill form"
- When OFF (default): Show reservation form for manual entry
- When ON: Show text input + form below
  - Placeholder: "Describe the reservation (e.g., 'Meeting with client John about Q2 strategy')"
  - User types description
  - Backend/AI parses text → extracts `name`, `email`, `description`
  - Form fields auto-populate
  - User can still manually edit any field

#### 3.4 Reservation Form
- **Name** (text input) — auto-filled by AI if toggled ON
- **Email** (text input) — auto-filled by AI if toggled ON
- **Responsible Person** (dropdown/autocomplete, existing users)
- **Area** (select dropdown)
- **Description/Observations** (textarea) — auto-filled by AI if toggled ON
- All fields are editable

#### 3.5 Submit Buttons
- "Save Reservation" (primary button)
- "Cancel" (secondary button)

---

## Frontend Implementation

### Component Structure
```
MonthlyView
  └─ onDayClick(date)
      → setState({ selectedDate: date })
      → render WeeklyView

WeeklyView
  ├─ State:
  │   ├─ selectedDate
  │   ├─ selectedHours: Array<{date, hour, startTime, endTime}> (can be non-contiguous)
  │   ├─ occupiedIntervals: Array<{start_time, end_time, responsible_name, ...}> (from API)
  │
  ├─ useEffect: Fetch occupiedIntervals for week
  │
  ├─ onHourClick(dateTime) → toggleHour(dateTime) or startDrag
  ├─ onHourDrag(startDateTime, endDateTime) → selectRange(start, end)
  ├─ onCtrlClick(dateTime) → addHour(dateTime) (multi-select)
  │
  ├─ renderGrid(occupied, selected)
  └─ renderButton("Book Selected Hours") 
      → openReservationModal(selectedHours)

ReservationModal
  ├─ Props: selectedHours: Array, onClose, onSave
  │
  ├─ State:
  │   ├─ aiToggled: boolean
  │   ├─ aiText: string
  │   ├─ form: { name, email, responsibleId, area, description }
  │
  ├─ onAIToggle(true)
  │   → show textInput
  │   → onAITextChange(text)
  │       → call POST /api/ai/parse-reservation
  │       → receive { name, email, description }
  │       → updateForm(parsed)
  │
  ├─ onFormChange(field, value) → updateForm
  │
  ├─ onSave()
  │   → POST /api/reservations/multi with { selectedHours, form }
  │   → Backend creates N reservation rows (one per hour block)
  │   → Close modal, refresh WeeklyView
  │
  └─ renderForm()
```

---

## Backend API Endpoints

### 1. GET `/api/reservations/week`
**Query params:** `date=2026-05-05`  
**Returns:** All reservations for that week
```json
{
  "reservations": [
    {
      "id": "...",
      "start_time": "2026-05-05T09:00:00Z",
      "end_time": "2026-05-05T11:00:00Z",
      "responsible_name": "John Doe",
      "area": "Sala A",
      "status": "active"
    }
  ]
}
```

### 2. POST `/api/reservations/multi` (NEW)
**Body:**
```json
{
  "intervals": [
    { "start_time": "2026-05-05T09:00:00Z", "end_time": "2026-05-05T11:00:00Z" },
    { "start_time": "2026-05-05T13:00:00Z", "end_time": "2026-05-05T15:00:00Z" }
  ],
  "responsible_id": "user-123",
  "responsible_name": "John Doe",
  "area": "Sala A",
  "observations": "Team sync",
  "grouped_id": "group-abc" (optional)
}
```
**Action:** Create one reservation row per interval (bulk insert)  
**Returns:** { "success": true, "created_ids": [...] }

### 3. POST `/api/ai/parse-reservation` (EXISTING, if available)
**Body:** `{ "text": "Meeting with client John about Q2 strategy" }`  
**Returns:**
```json
{
  "name": "John",
  "email": "john@example.com",
  "description": "Meeting about Q2 strategy"
}
```
*(Adapt to your existing AI integration; only return fields that were successfully parsed)*

### 4. POST `/api/calendar-events` (EXISTING, for holidays)
No changes; keep existing holiday endpoint.

---

## Edge Cases & Validation

1. **Conflict detection:** Before saving, backend checks `start_time` / `end_time` ranges against existing reservations. Return 409 Conflict if overlap.
2. **Past dates:** Prevent booking in the past; frontend disables or backend rejects.
3. **Multi-select non-contiguous:** When user selects 9am, 12pm, 3pm (separate), treat as three separate 1-hour intervals.
4. **Partial overlap:** If user selects 9–12 but 11–12 is occupied, show warning and require confirmation or re-selection.
5. **AI parse failure:** If AI fails to extract fields, show error but keep form visible for manual entry.

---

## Styling & UX Details

- **Selected hour cells:** Light blue background + border
- **Occupied slots:** Gray background, cursor: not-allowed
- **Available slots:** White background, cursor: pointer, hover: light gray
- **Multi-select indicator:** Outline or dashed border on Ctrl+clicked cells
- **Mobile:** Stack modal vertically; time grid remains side-scrollable
- **Accessibility:** Keyboard nav (arrow keys to navigate hours, Enter to toggle, Escape to close modal)

---

## Summary of Changes

**Frontend:**
- Monthly view: Add day-click handler → transition to weekly
- Weekly view: New component with time grid + availability fetching
- Reservation modal: Refactor existing form, add AI toggle + text input
- State management: Track selected hours, occupied intervals, modal visibility

**Backend:**
- `GET /api/reservations/week` – fetch occupied intervals
- `POST /api/reservations/multi` – bulk insert for multiple intervals (call existing insert N times with `grouped_id`)
- Reuse existing `POST /api/ai/parse-reservation` if available

**Database:**
- Optional: Add `grouped_id UUID` column to reservations for bulk operations
- No other schema changes needed

---

## Implementation Order

1. Backend: Add `/api/reservations/week` endpoint
2. Frontend: Build WeeklyView component with grid + availability
3. Frontend: Build ReservationModal with form + AI toggle
4. Backend: Add `/api/reservations/multi` endpoint
5. Frontend: Wire up flows (monthly → weekly → modal → save)
6. Testing: Multi-interval bookings, conflict detection, AI text parsing
7. Polish: Styling, mobile responsiveness, accessibility
