# Premium Telegram WebApp-Style Course Cabinet (Static MVP) trigger pages build

This is a **no-build static web app** (HTML/CSS/JS only) designed to look like a premium dark mobile app inside Telegram.

## Project files

- `index.html` — dashboard (profile, progress, lessons row)
- `lesson.html` — lesson details page
- `styles.css` — premium dark theme styles
- `app.js` — main app logic (Telegram profile, progress, rendering)
- `csv.js` — robust CSV parser helper
- `config.js` — **all editable settings in one file**
- `sample-sheet.csv` — local demo data for instant testing

---

## 1) Quick start (2 minutes)

1. Open `config.js`
2. Keep `useSampleData: true`
3. Open `index.html` in your browser

That’s it — no install/build required.

---

## 2) Google Sheet template (CMS)

Create a Google Sheet with this exact header row:

```csv
course_id,lesson_id,day_number,title,subtitle,preview_image_url,video_url,content_html,content_text,attachments,is_locked
```

### Column meanings

- `course_id` — course key (for filtering), e.g. `course_alpha`
- `lesson_id` — unique ID, e.g. `day1`, `day2`
- `day_number` — numeric order
- `title` — lesson title
- `subtitle` — short description on card
- `preview_image_url` — optional (reserved for future use)
- `video_url` — optional (YouTube/video URL)
- `content_html` — optional HTML content for lesson page
- `content_text` — optional plain text content (used if `content_html` is empty)
- `attachments` — optional URLs separated by `|`
- `is_locked` — `0` or `1`

### Example rows

```csv
course_alpha,day1,1,Welcome,Start here,,https://www.youtube.com/watch?v=dQw4w9WgXcQ,,Your first task,https://example.com/file.pdf,0
course_alpha,day2,2,Research,Client research day,,,<p>Do this first.</p>,,https://example.com/a.pdf|https://example.com/b.docx,0
course_alpha,day3,3,Package,Build your package,,,,Write your package details,,1
```

---

## 3) Publish Google Sheet to public CSV

1. In Google Sheets: **File → Share → Publish to web**
2. Select your sheet tab
3. Choose format: **CSV**
4. Copy the generated CSV URL

Paste it in `config.js`:

```js
googleSheetCsvUrl: "https://docs.google.com/spreadsheets/d/.../export?format=csv"
```

Then set:

```js
useSampleData: false
```

And set your course filter:

```js
courseId: "course_alpha"
```

---

## 4) Brand customization (single file)

Edit only `config.js`:

- `brandName`
- `accentColor`
- `backgroundColor`
- `cardColor`
- `courseId`
- `googleSheetCsvUrl`
- `useSampleData`

Theme colors are applied through CSS root variables for easy control.

---

## 5) Deploy to GitHub Pages

1. Create a GitHub repository and upload these files
2. GitHub repo → **Settings → Pages**
3. Source: deploy from branch (`main` / root)
4. Save
5. Open the provided Pages URL

Because this app is fully static, it works directly on GitHub Pages.

---

## 6) Telegram WebApp note (optional)

When opened inside Telegram WebApp, the app reads:

`window.Telegram.WebApp.initDataUnsafe.user`

- Shows user full name in the profile header
- Uses initials avatar placeholder
- Shows “Connected to Telegram” badge

Outside Telegram, it falls back to “Student” and “Web mode”.

---

## MVP behavior summary

- Dashboard shows a **single-row horizontal swipeable lesson list**
- Lesson page supports title/content/video/attachments
- “Mark as completed” uses `localStorage`
- Progress bar and percentage are auto-calculated
- “Reset progress” clears local progress for testing
- Loading skeleton + friendly empty/error states included
