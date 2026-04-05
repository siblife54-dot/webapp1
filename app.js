(function () {
  "use strict";

  var STORAGE_KEY = "course_completed_lessons_v1";
  var LEGACY_STORAGE_KEY = "completedLessons";
  var DEBUG_IMG_STATUS = {};
  var DEBUG_LAST_CONTEXT = null;
  var APP_STORAGE = null;
  var APP_PROFILE = null;
  var NUTRITION = null;
  var LAST_LESSONS = [];
  var STORAGE_DEBUG = {
    telegramDetected: false,
    cloudAvailable: false,
    activeStorage: "local",
    migratedLocalToCloud: false
  };

  function getConfig() {
    return window.APP_CONFIG || {};
  }

  function applyTheme(config) {
    var root = document.documentElement;
    root.style.setProperty("--accent", config.accentColor || "#8B5CF6");
    root.style.setProperty("--bg", config.backgroundColor || "#0E1B2B");
    root.style.setProperty("--card", config.cardColor || "#12243a");

    var brand = document.getElementById("brandName");
    if (brand) brand.textContent = config.brandName || "Кабинет курса";
  }

  function initTelegramViewport() {
    var tg = globalThis.Telegram && globalThis.Telegram.WebApp;
    if (!tg) return;

    if (typeof tg.ready === "function") tg.ready();
    if (typeof tg.expand === "function") tg.expand();
  }

  function getUserName(profile) {
    if (!profile) return "Студент";
    return profile.fullName || profile.firstName || profile.username || "Студент";
  }

  function getInitials(name) {
    var clean = (name || "Студент").trim();
    var words = clean.split(/\s+/).filter(Boolean);
    if (!words.length) return "СТ";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function parseCompletedRaw(raw) {
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  async function loadCompleted() {
    var rawPrimary = await APP_STORAGE.getItem(STORAGE_KEY);
    var primary = parseCompletedRaw(rawPrimary);
    if (primary.length) return primary;

    var rawLegacy = await APP_STORAGE.getItem(LEGACY_STORAGE_KEY);
    return parseCompletedRaw(rawLegacy);
  }

  async function saveCompleted(ids) {
    var clean = Array.from(new Set(ids));
    var serialized = JSON.stringify(clean);
    await APP_STORAGE.setItem(STORAGE_KEY, serialized);
    await APP_STORAGE.setItem(LEGACY_STORAGE_KEY, serialized);
  }

  async function markCompleted(id) {
    var completed = await loadCompleted();
    if (!completed.includes(id)) {
      completed.push(id);
      await saveCompleted(completed);
    }
  }

  async function initStorage() {
    var platform = globalThis.CourseAppPlatform || {};
    var detectTelegramWebApp = platform.detectTelegramWebApp || function () { return false; };
    var getAppStorage = platform.getAppStorage;

    STORAGE_DEBUG.telegramDetected = Boolean(detectTelegramWebApp());
    STORAGE_DEBUG.cloudAvailable = Boolean(globalThis.Telegram && globalThis.Telegram.WebApp && globalThis.Telegram.WebApp.CloudStorage);

    if (typeof getAppStorage !== "function") {
      APP_STORAGE = {
        type: "local",
        cloudFailed: false,
        getItem: function (key) { return Promise.resolve(localStorage.getItem(key)); },
        setItem: function (key, value) { localStorage.setItem(key, value); return Promise.resolve(); },
        removeItem: function (key) { localStorage.removeItem(key); return Promise.resolve(); }
      };
      STORAGE_DEBUG.activeStorage = "local";
      return;
    }

    APP_STORAGE = await getAppStorage({ storageKey: STORAGE_KEY });
    STORAGE_DEBUG.activeStorage = APP_STORAGE.type || "local";

    if (STORAGE_DEBUG.activeStorage === "cloud") {
      var cloudRaw = await APP_STORAGE.getItem(STORAGE_KEY);
      var legacyRaw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!cloudRaw && legacyRaw) {
        await APP_STORAGE.setItem(STORAGE_KEY, legacyRaw);
        await APP_STORAGE.setItem(LEGACY_STORAGE_KEY, legacyRaw);
        STORAGE_DEBUG.migratedLocalToCloud = true;
      }
    }

    STORAGE_DEBUG.activeStorage = APP_STORAGE.type || STORAGE_DEBUG.activeStorage;
  }

  function getProfile() {
    var platform = globalThis.CourseAppPlatform || {};
    if (typeof platform.getTelegramUserProfile === "function") {
      var profile = platform.getTelegramUserProfile();
      if (profile && (profile.fullName || profile.firstName || profile.username)) {
        return profile;
      }
    }

    return {
      id: null,
      firstName: "Студент",
      lastName: "",
      fullName: "Студент",
      username: "",
      avatarUrl: "",
      hasAvatar: false,
      isTelegram: false
    };
  }

  function normalizeLesson(raw) {
    return {
      course_id: raw.course_id,
      lesson_id: raw.lesson_id,
      day_number: Number(raw.day_number || 0),
      title: raw.title || "Без названия",
      subtitle: raw.subtitle || "",
      preview_image_url: raw.preview_image_url || "",
      preview_image_: raw.preview_image_ || "",
      video_url: raw.video_url || "",
      content_html: raw.content_html || "",
      content_text: raw.content_text || "",
      attachments: raw.attachments || ""
    };
  }

  async function fetchLessons(config) {
    var url = config.useSampleData ? (config.sampleCsvPath || "./sample-sheet.csv") : config.googleSheetCsvUrl;
    if (!url) throw new Error("Не указан CSV URL. Проверьте config.js");

    var response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Ошибка загрузки данных. Проверьте CSV URL и публичный доступ.");
    }

    var text = await response.text();
    var rows = window.CSVUtils.parseCSV(text);

    return rows
      .map(normalizeLesson)
      .filter(function (r) {
        return r.course_id === config.courseId;
      })
      .sort(function (a, b) {
        return a.day_number - b.day_number;
      });
  }

  function getMaxCompletedDayNumber(lessons, completed) {
    var maxDay = 0;
    lessons.forEach(function (lesson) {
      if (completed.includes(lesson.lesson_id) && lesson.day_number > maxDay) {
        maxDay = lesson.day_number;
      }
    });
    return maxDay;
  }

  function getAccessibilityModel(lessons, completed) {
    var maxCompletedDayNumber = getMaxCompletedDayNumber(lessons, completed);
    var threshold = maxCompletedDayNumber + 1;
    var map = {};

    lessons.forEach(function (lesson) {
      var isSequentiallyOpen = lesson.day_number <= threshold;
      map[lesson.lesson_id] = isSequentiallyOpen;
    });

    return {
      maxCompletedDayNumber: maxCompletedDayNumber,
      threshold: threshold,
      map: map
    };
  }

  function isDebugMode() {
    var params = new URLSearchParams(window.location.search);
    return params.get("debug") === "1";
  }

  function extractGoogleDriveFileId(url) {
    var value = String(url || "").trim();
    if (!value) return null;

    var byFilePath = value.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (byFilePath && byFilePath[1]) return byFilePath[1];

    var byGoogleusercontent = value.match(/googleusercontent\.com\/.*?\/d\/([^/]+)/i);
    if (byGoogleusercontent && byGoogleusercontent[1]) return byGoogleusercontent[1];

    try {
      var parsed = new URL(value);
      var idFromParam = parsed.searchParams.get("id");
      if (idFromParam) return idFromParam;
    } catch (e) {
      return null;
    }

    return null;
  }

  function normalizePreviewImageUrl(url) {
    var value = String(url || "").trim();
    if (!value) return "";

    var driveId = extractGoogleDriveFileId(value);
    if (driveId) {
      return "https://drive.google.com/thumbnail?id=" + driveId + "&sz=w1200";
    }

    return value;
  }

  function getPreviewSrc(lesson) {
    var raw = String(lesson.preview_image_url || lesson.preview_image_ || "").trim();
    if (!raw) return "";
    return normalizePreviewImageUrl(raw);
  }

  async function renderDebugPanel(config, lessons, completed, model) {
    if (!isDebugMode()) return;

    DEBUG_LAST_CONTEXT = {
      config: config,
      lessons: lessons,
      completed: completed,
      model: model
    };

    var existing = document.getElementById("debugPanel");
    if (existing) existing.remove();

    var panel = document.createElement("aside");
    panel.id = "debugPanel";
    panel.className = "debug-panel";

    var rawStorage = await APP_STORAGE.getItem(STORAGE_KEY);
    var rawLegacy = await APP_STORAGE.getItem(LEGACY_STORAGE_KEY);

    var lines = [
      "DEBUG MODE",
      "courseId: " + (config.courseId || "(пусто)"),
      "total lessons loaded: " + lessons.length,
      "storage." + STORAGE_KEY + ": " + String(rawStorage),
      "storage." + LEGACY_STORAGE_KEY + " raw value: " + String(rawLegacy),
      "parsed completedLessons array: " + JSON.stringify(completed),
      "maxCompletedDayNumber: " + model.maxCompletedDayNumber,
      "unlockThreshold: " + model.threshold,
      "Telegram WebApp detected: " + (STORAGE_DEBUG.telegramDetected ? "yes" : "no"),
      "CloudStorage available: " + (STORAGE_DEBUG.cloudAvailable ? "yes" : "no"),
      "Active storage: " + STORAGE_DEBUG.activeStorage,
      "Telegram user id: " + String(APP_PROFILE && APP_PROFILE.id),
      "first_name: " + String(APP_PROFILE && APP_PROFILE.firstName),
      "last_name: " + String(APP_PROFILE && APP_PROFILE.lastName),
      "username: " + String(APP_PROFILE && APP_PROFILE.username),
      "avatar available: " + ((APP_PROFILE && APP_PROFILE.hasAvatar) ? "yes" : "no"),
      "migrated local -> cloud: " + (STORAGE_DEBUG.migratedLocalToCloud ? "yes" : "no"),
      ""
    ];

    if (NUTRITION) {
      var nutritionDebug = NUTRITION.getDebugInfo();
      lines.push("calculator data exists: " + (nutritionDebug.exists ? "yes" : "no"));
      lines.push("calculator storage used: " + (nutritionDebug.storageUsed || "unknown"));
      lines.push("calculator updatedAt: " + (nutritionDebug.updatedAt || "-"));
      lines.push("calculator values loaded successfully: " + (nutritionDebug.loadedSuccessfully ? "yes" : "no"));
      lines.push("");
    }

    lessons.forEach(function (lesson) {
      var normalizedPreview = getPreviewSrc(lesson);
      var imgStatus = DEBUG_IMG_STATUS[lesson.lesson_id] || "PENDING";

      lines.push(
        [
          "lesson_id=" + lesson.lesson_id,
          "day_number=" + lesson.day_number,
          "accessible=" + Boolean(model.map[lesson.lesson_id])
        ].join(" | ")
      );
      lines.push("preview_image_url(raw): " + String(lesson.preview_image_url || ""));
      lines.push("preview_image_(raw): " + String(lesson.preview_image_ || ""));
      lines.push("preview_image(normalized): " + String(normalizedPreview));
      lines.push("video_url(raw): " + String(lesson.video_url || ""));
      lines.push("img: " + imgStatus);
      lines.push("");
    });

    panel.textContent = lines.join("\n");
    document.body.appendChild(panel);
  }

  async function refreshDebugPanel() {
    if (!DEBUG_LAST_CONTEXT || !isDebugMode()) return;
    await renderDebugPanel(
      DEBUG_LAST_CONTEXT.config,
      DEBUG_LAST_CONTEXT.lessons,
      DEBUG_LAST_CONTEXT.completed,
      DEBUG_LAST_CONTEXT.model
    );
  }



  function getNutritionLessonLink() {
    if (!LAST_LESSONS || !LAST_LESSONS.length) return null;
    var nutritionLesson = LAST_LESSONS.find(function (lesson) {
      return /питан/i.test(lesson.title || "");
    });
    if (!nutritionLesson) return null;
    return "./lesson.html?id=" + encodeURIComponent(nutritionLesson.lesson_id);
  }

  async function renderNutritionCard() {
    var host = document.getElementById("nutritionCardHost");
    if (!host || !NUTRITION) return;

    var plan = await NUTRITION.loadPlan();
    var hasPlan = Boolean(plan && plan.calories);

    host.innerHTML = [
      '<section class="card nutrition-card">',
      '<h3>Ваш план питания</h3>',
      (hasPlan
        ? '<p><strong>' + plan.calories + ' ккал/день</strong></p><p>Б ' + plan.protein + ' · Ж ' + plan.fats + ' · У ' + plan.carbs + '</p><p>Цель: ' + NUTRITION.formatGoal(plan.goal) + '</p>'
        : '<p>Рассчитай свою норму калорий и БЖУ, чтобы пройти курс с понятной отправной точкой.</p>'),
      '<button type="button" class="btn btn-primary" id="nutritionOpenBtn">' + (hasPlan ? 'Пересчитать' : 'Рассчитать КБЖУ') + '</button>',
      '</section>'
    ].join('');

    var profileHint = document.getElementById("profileNutritionHint");
    if (profileHint) {
      profileHint.textContent = hasPlan ? ('КБЖУ: ' + plan.calories + ' ккал') : '';
    }

    var openBtn = document.getElementById("nutritionOpenBtn");
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        NUTRITION.open(plan || null);
      });
    }
  }

  async function renderDashboard(lessons, config) {
    var name = getUserName(APP_PROFILE);
    var avatar = document.getElementById("avatar");
    var studentName = document.getElementById("studentName");
    var list = document.getElementById("lessonsContainer");
    var stateBox = document.getElementById("stateBox");

    studentName.textContent = name;
    avatar.textContent = getInitials(name);
    avatar.style.backgroundImage = "";
    if (APP_PROFILE && APP_PROFILE.avatarUrl) {
      avatar.textContent = "";
      avatar.style.backgroundImage = "url(\"" + escapeAttr(APP_PROFILE.avatarUrl) + "\")";
      avatar.style.backgroundSize = "cover";
      avatar.style.backgroundPosition = "center";
    }

    var completed = await loadCompleted();
    var accessModel = getAccessibilityModel(lessons, completed);

    await renderNutritionCard();
    await renderDebugPanel(config, lessons, completed, accessModel);

    if (!lessons.length) {
      list.innerHTML = "";
      stateBox.hidden = false;
      stateBox.textContent = "Нет доступных уроков";
      await renderProgress(lessons);
      return;
    }

    stateBox.hidden = true;

    list.innerHTML = lessons.map(function (lesson) {
      var done = completed.includes(lesson.lesson_id);
      var accessible = Boolean(accessModel.map[lesson.lesson_id]);
      var locked = !accessible;

      return [
        '<article class="lesson-card' + (locked ? ' locked' : '') + '">',
        '<div class="lesson-preview">',
        (getPreviewSrc(lesson) ? '<img src="' + escapeAttr(getPreviewSrc(lesson)) + '" alt="Превью урока" loading="lazy" data-lesson-id="' + escapeAttr(lesson.lesson_id) + '">' : ''),
        '</div>',
        '<div class="lesson-card-body">',
        '<div class="lesson-meta">',
        '<span class="lesson-day">День ' + (lesson.day_number || "-") + '</span>',
        '<div class="lesson-indicators">',
        (done ? '<span class="status done">Пройдено</span>' : ''),
        (locked ? '<span class="status locked">Закрыто</span>' : ''),
        '</div>',
        '</div>',
        '<h3>' + escapeHtml(lesson.title) + '</h3>',
        '<p>' + escapeHtml(lesson.subtitle || "Описание отсутствует") + '</p>',
        '<div class="lesson-actions">',
        (locked
          ? '<button class="btn btn-open" type="button" disabled>Открыть</button>'
          : '<a class="btn btn-open" href="./lesson.html?id=' + encodeURIComponent(lesson.lesson_id) + '">Открыть</a>'),
        '</div>',
        '</div>',
        '</article>'
      ].join("");
    }).join("");

    if (isDebugMode()) {
      var previewImages = list.querySelectorAll(".lesson-preview img[data-lesson-id]");
      previewImages.forEach(function (img) {
        var lessonId = img.getAttribute("data-lesson-id") || "";

        img.addEventListener("load", function () {
          DEBUG_IMG_STATUS[lessonId] = "OK";
          console.log("[IMG OK] lesson_id=" + lessonId + " src=" + img.currentSrc);
          void refreshDebugPanel();
        });

        img.addEventListener("error", function () {
          DEBUG_IMG_STATUS[lessonId] = "FAIL";
          console.log("[IMG FAIL] lesson_id=" + lessonId + " src=" + img.currentSrc);
          img.style.display = "none";
          void refreshDebugPanel();
        });

        if (img.complete && img.naturalWidth > 0) {
          DEBUG_IMG_STATUS[lessonId] = "OK";
        }
      });
      void refreshDebugPanel();
    }

    await renderProgress(lessons);
  }

  async function renderProgress(lessons) {
    var completed = await loadCompleted();
    var total = lessons.length;
    var completedCount = lessons.filter(function (l) {
      return completed.includes(l.lesson_id);
    }).length;

    var pct = total ? Math.round((completedCount / total) * 100) : 0;

    document.getElementById("progressText").textContent = "Пройдено: " + completedCount + " из " + total;
    document.getElementById("progressPct").textContent = pct + "%";
    document.getElementById("progressFill").style.width = pct + "%";
  }

  function extractYouTubeId(url) {
    if (!url) return null;
    var re = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/;
    var match = url.match(re);
    return match ? match[1] : null;
  }

  function isYandexUrl(url) {
    return /(?:disk\.yandex\.ru|yadi\.sk)/i.test(url || "");
  }

  function isYandexEmbedUrl(url) {
    return /(?:embed|iframe|video-player|\/i\/)/i.test(url || "");
  }

  function extractDriveFileId(url) {
    if (!url) return null;

    var byPath = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (byPath && byPath[1]) return byPath[1];

    try {
      var parsed = new URL(url);
      var fromId = parsed.searchParams.get("id");
      if (fromId) return fromId;
    } catch (e) {
      return null;
    }

    return null;
  }

  function normalizeMediaUrl(url, type) {
    var value = String(url || "").trim();
    if (!value) return "";

    var driveFileId = extractDriveFileId(value);
    if (driveFileId) {
      if (type === "video") {
        return "https://drive.google.com/file/d/" + driveFileId + "/preview";
      }
      return value;
    }

    if (/drive\.google\.com\/drive\/folders\//i.test(value)) {
      return value;
    }

    if (isYandexUrl(value)) {
      return value;
    }

    if (type === "video") {
      var youtubeId = extractYouTubeId(value);
      if (youtubeId) return "https://www.youtube.com/embed/" + youtubeId;
    }

    return value;
  }

  function getVideoRenderModel(url) {
    var normalized = normalizeMediaUrl(url, "video");
    if (!normalized) {
      return { mode: "none", url: "" };
    }

    if (isYandexUrl(normalized) && !isYandexEmbedUrl(normalized)) {
      return { mode: "link", url: normalized };
    }

    if (/^https:\/\//i.test(normalized)) {
      return { mode: "embed", url: normalized };
    }

    return { mode: "none", url: "" };
  }

  // ===== Attachments: parse + tags =====
  function parseAttachments(raw) {
    if (!raw) return [];

    // Каждая строка = один материал
    var lines = String(raw)
      .split(/\r?\n|;/g) // перенос строки или ;
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    var files = lines.map(function (line, idx) {
      var name = "Материал " + (idx + 1);
      var url = "";

      if (line.indexOf("|") !== -1) {
        var parts = line.split("|").map(function (x) { return x.trim(); });
        var a = parts[0] || "";
        var b = parts[1] || "";

        var aIsUrl = /^https?:\/\//i.test(a);
        var bIsUrl = /^https?:\/\//i.test(b);

        // Поддержка: "URL | Название" и "Название | URL"
        if (aIsUrl && !bIsUrl) { url = a; name = b || name; }
        else if (bIsUrl && !aIsUrl) { url = b; name = a || name; }
        else { name = a || name; url = b || ""; }
      } else {
        url = line;
      }

      url = normalizeMediaUrl(url, "file");

      return { name: name, url: url };
    });

    // Убираем мусор: пустые или не ссылки
    return files.filter(function (f) {
      return /^https?:\/\//i.test(f.url);
    });
  }

  function getFileExt(nameOrUrl) {
    var v = String(nameOrUrl || "").trim().toLowerCase();
    v = v.split("#")[0].split("?")[0];
    var m = v.match(/\.([a-z0-9]{1,6})$/i);
    return m ? m[1].toUpperCase() : "";
  }

  function getFileTag(file) {
    var ext = getFileExt(file.name);
    if (!ext) ext = getFileExt(file.url);

    if (!ext) return "LINK";
    if (ext === "PDF") return "PDF";
    if (ext === "DOC" || ext === "DOCX") return "DOC";
    if (ext === "XLS" || ext === "XLSX" || ext === "CSV") return "XLS";
    if (ext === "PPT" || ext === "PPTX") return "PPT";
    if (ext === "ZIP" || ext === "RAR" || ext === "7Z") return "ZIP";
    if (ext === "JPG" || ext === "JPEG" || ext === "PNG" || ext === "WEBP") return "IMG";
    return ext;
  }
  // ====================================

  async function renderLesson(lessons) {
    var stateBox = document.getElementById("lessonState");
    var main = document.getElementById("lessonMain");
    var id = new URLSearchParams(window.location.search).get("id");

    if (!id) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "ID урока не найден. Откройте урок из списка.";
      return;
    }

    var lesson = lessons.find(function (l) {
      return l.lesson_id === id;
    });

    if (!lesson) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Урок не найден для выбранного курса.";
      return;
    }

    var completed = await loadCompleted();
    var accessModel = getAccessibilityModel(lessons, completed);
    if (!accessModel.map[lesson.lesson_id]) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Этот урок пока недоступен.";
      return;
    }

    stateBox.hidden = true;
    main.hidden = false;

    document.getElementById("lessonDay").textContent = "День " + (lesson.day_number || "-");
    document.getElementById("lessonTitle").textContent = lesson.title;
    document.getElementById("lessonSubtitle").textContent = lesson.subtitle || "";

    var lessonNutritionHost = document.getElementById("lessonNutritionHost");
    if (lessonNutritionHost) {
      lessonNutritionHost.innerHTML = "";
    }

    var content = document.getElementById("lessonContent");
    if (lesson.content_html) {
      content.innerHTML = lesson.content_html;
    } else {
      content.textContent = lesson.content_text || "Содержимое урока пока пустое.";
    }

    var videoModel = getVideoRenderModel(lesson.video_url);
    var videoWrap = document.getElementById("videoWrap");
    var frame = document.getElementById("videoFrame");
    var videoLinkCard = document.getElementById("videoLinkCard");
    var videoLinkButton = document.getElementById("videoLinkButton");

  if (videoModel.mode === "embed") {
  // Разрешения для fullscreen / PiP (особенно важно для iOS WebView)
  frame.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
  frame.setAttribute("allowfullscreen", "true");
  frame.setAttribute("playsinline", "true");

  frame.src = videoModel.url;
  videoWrap.hidden = false;

  // Дублируем ссылку “Открыть” как запасной вариант (полезно для iOS/Drive)
  videoLinkButton.href = videoModel.url;
  videoLinkCard.hidden = false;
} else if (videoModel.mode === "link") {
  videoLinkButton.href = videoModel.url;
  videoLinkCard.hidden = false;
} else {
  // Ничего не показываем
  videoWrap.hidden = true;
  videoLinkCard.hidden = true;
  frame.removeAttribute("src");
}

    // ===== Materials rendering (fixed) =====
    var attachmentsWrap = document.getElementById("attachmentsWrap");
    var attachmentsList = document.getElementById("attachmentsList");
    var files = parseAttachments(lesson.attachments);

    if (files.length) {
      attachmentsWrap.hidden = false;
      attachmentsList.innerHTML = files.map(function (f) {
        var tag = getFileTag(f);
        return (
          '<li class="attach-item">' +
            '<a class="attach-link" href="' + escapeAttr(f.url) + '" target="_blank" rel="noopener noreferrer">' +
              '<span class="attach-name">' + escapeHtml(f.name) + '</span>' +
              '<span class="file-tag">' + escapeHtml(tag) + '</span>' +
            '</a>' +
          '</li>'
        );
      }).join("");
    } else {
      attachmentsWrap.hidden = true;
      attachmentsList.innerHTML = "";
    }
    // ======================================

    var completeBtn = document.getElementById("completeBtn");
    if (completed.includes(lesson.lesson_id)) {
      completeBtn.textContent = "Пройдено ✓";
      completeBtn.disabled = true;
    }

    completeBtn.addEventListener("click", async function () {
      await markCompleted(lesson.lesson_id);
      completeBtn.textContent = "Пройдено ✓";
      completeBtn.disabled = true;
      setTimeout(function () {
        window.location.href = "./index.html";
      }, 250);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "");
  }

  function showDashboardLoading() {
    var list = document.getElementById("lessonsContainer");
    var box = document.getElementById("stateBox");
    box.hidden = false;
    box.textContent = "Загрузка уроков...";
    list.innerHTML = [
      '<div class="lesson-card skeleton" aria-hidden="true" style="height:220px"></div>',
      '<div class="lesson-card skeleton" aria-hidden="true" style="height:220px"></div>'
    ].join("");
  }

  function showDashboardError(message) {
    document.getElementById("lessonsContainer").innerHTML = "";
    var box = document.getElementById("stateBox");
    box.hidden = false;
    box.textContent = message || "Ошибка загрузки данных";
  }

  async function init() {
    var config = getConfig();
    applyTheme(config);
    initTelegramViewport();
    await initStorage();
    APP_PROFILE = getProfile();
    if (globalThis.NutritionCalculator && typeof globalThis.NutritionCalculator.create === "function") {
      NUTRITION = globalThis.NutritionCalculator.create({
        storage: APP_STORAGE,
        onPlanSaved: function () {
          if (document.body.getAttribute("data-page") === "dashboard") {
            void renderNutritionCard();
          }
        },
        getLessonLink: getNutritionLessonLink
      });
    }

    var page = document.body.getAttribute("data-page");
    if (page === "dashboard") {
      showDashboardLoading();
    }

    try {
      var lessons = await fetchLessons(config);
      LAST_LESSONS = lessons.slice();
      if (page === "dashboard") await renderDashboard(lessons, config);
      if (page === "lesson") await renderLesson(lessons);
    } catch (error) {
      if (page === "dashboard") {
        showDashboardError(error.message || "Ошибка загрузки данных");
      } else {
        var stateBox = document.getElementById("lessonState");
        stateBox.classList.remove("skeleton");
        stateBox.textContent = error.message || "Не удалось загрузить урок.";
      }
    }
  }
// Делает всю карточку урока кликабельной
document.addEventListener("click", function (e) {

  var card = e.target.closest(".lesson-card");
  if (!card) return;

  // если нажали на кнопку — пусть работает как раньше
  if (e.target.closest(".btn")) return;

  var button = card.querySelector(".btn");
  if (button) {
    button.click();
  }

});
  init();
})();
