(function () {
  "use strict";

  var STORAGE_KEY = "course_completed_lessons_v1";
  var LEGACY_STORAGE_KEY = "completedLessons";

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

  function getTelegramUser() {
    var user = globalThis.Telegram?.WebApp?.initDataUnsafe?.user;
    return user || null;
  }

  function initTelegramViewport() {
    var tg = globalThis.Telegram && globalThis.Telegram.WebApp;
    if (!tg) return;

    if (typeof tg.ready === "function") tg.ready();
    if (typeof tg.expand === "function") tg.expand();
  }

  function getUserName(user) {
    if (!user) return "Студент";
    var full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return full || user.username || "Студент";
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

  function loadCompleted() {
    var rawPrimary = localStorage.getItem(STORAGE_KEY);
    var primary = parseCompletedRaw(rawPrimary);
    if (primary.length) return primary;

    var rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    return parseCompletedRaw(rawLegacy);
  }

  function saveCompleted(ids) {
    var clean = Array.from(new Set(ids));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(clean));
  }

  function markCompleted(id) {
    var completed = loadCompleted();
    if (!completed.includes(id)) {
      completed.push(id);
      saveCompleted(completed);
    }
  }

  function normalizeLesson(raw) {
    return {
      course_id: raw.course_id,
      lesson_id: raw.lesson_id,
      day_number: Number(raw.day_number || 0),
      title: raw.title || "Без названия",
      subtitle: raw.subtitle || "",
      preview_image_url: raw.preview_image_url || "",
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

  function renderDebugPanel(config, lessons, completed, model) {
    if (!isDebugMode()) return;

    var existing = document.getElementById("debugPanel");
    if (existing) existing.remove();

    var panel = document.createElement("aside");
    panel.id = "debugPanel";
    panel.className = "debug-panel";

    var rawStorage = localStorage.getItem(STORAGE_KEY);
    var rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);

    var lines = [
      "DEBUG MODE",
      "courseId: " + (config.courseId || "(пусто)"),
      "total lessons loaded: " + lessons.length,
      "localStorage." + STORAGE_KEY + ": " + String(rawStorage),
      "localStorage.completedLessons raw value: " + String(rawLegacy),
      "parsed completedLessons array: " + JSON.stringify(completed),
      "maxCompletedDayNumber: " + model.maxCompletedDayNumber,
      "unlockThreshold: " + model.threshold,
      ""
    ];

    lessons.forEach(function (lesson) {
      lines.push(
        [
          "lesson_id=" + lesson.lesson_id,
          "day_number=" + lesson.day_number,
          "accessible=" + Boolean(model.map[lesson.lesson_id])
        ].join(" | ")
      );
    });

    panel.textContent = lines.join("\n");
    document.body.appendChild(panel);
  }

  function renderDashboard(lessons, config) {
    var user = getTelegramUser();
    var name = getUserName(user);
    var avatar = document.getElementById("avatar");
    var studentName = document.getElementById("studentName");
    var list = document.getElementById("lessonsContainer");
    var stateBox = document.getElementById("stateBox");

    studentName.textContent = name;
    avatar.textContent = getInitials(name);

    var completed = loadCompleted();
    var accessModel = getAccessibilityModel(lessons, completed);

    renderDebugPanel(config, lessons, completed, accessModel);

    if (!lessons.length) {
      list.innerHTML = "";
      stateBox.hidden = false;
      stateBox.textContent = "Нет доступных уроков";
      renderProgress(lessons);
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
        (lesson.preview_image_url ? '<img src="' + escapeAttr(lesson.preview_image_url) + '" alt="Превью урока" loading="lazy" onerror="this.style.display=\'none\'">' : ''),
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

    renderProgress(lessons);
  }

  function renderProgress(lessons) {
    var completed = loadCompleted();
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

  function getSafeVideoEmbed(url) {
    var youtubeId = extractYouTubeId(url);
    if (youtubeId) return "https://www.youtube.com/embed/" + youtubeId;

    if (/^https:\/\//i.test(url)) return url;
    return null;
  }

  function renderLesson(lessons) {
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

    var completed = loadCompleted();
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

    var content = document.getElementById("lessonContent");
    if (lesson.content_html) {
      content.innerHTML = lesson.content_html;
    } else {
      content.textContent = lesson.content_text || "Содержимое урока пока пустое.";
    }

    var safeVideo = getSafeVideoEmbed(lesson.video_url);
    if (safeVideo) {
      var videoWrap = document.getElementById("videoWrap");
      var frame = document.getElementById("videoFrame");
      frame.src = safeVideo;
      videoWrap.hidden = false;
    }

    var attachmentsWrap = document.getElementById("attachmentsWrap");
    var attachmentsList = document.getElementById("attachmentsList");
    var attachments = (lesson.attachments || "")
      .split("|")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);

    if (attachments.length) {
      attachmentsWrap.hidden = false;
      attachmentsList.innerHTML = attachments.map(function (url, i) {
        var safe = /^https?:\/\//i.test(url) ? url : "#";
        return '<li><a href="' + safe + '" target="_blank" rel="noopener noreferrer">Материал ' + (i + 1) + '</a></li>';
      }).join("");
    }

    var completeBtn = document.getElementById("completeBtn");
    if (completed.includes(lesson.lesson_id)) {
      completeBtn.textContent = "Пройдено ✓";
      completeBtn.disabled = true;
    }

    completeBtn.addEventListener("click", function () {
      markCompleted(lesson.lesson_id);
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

    var page = document.body.getAttribute("data-page");
    if (page === "dashboard") {
      showDashboardLoading();
    }

    try {
      var lessons = await fetchLessons(config);
      if (page === "dashboard") renderDashboard(lessons, config);
      if (page === "lesson") renderLesson(lessons);
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

  init();
})();
