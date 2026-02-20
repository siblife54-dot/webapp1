(function () {
  "use strict";

  var STORAGE_KEY = "course_completed_lessons_v1";

  function getConfig() {
    return window.APP_CONFIG || {};
  }

  function applyTheme(config) {
    var root = document.documentElement;
    root.style.setProperty("--accent", config.accentColor || "#5f8bff");
    root.style.setProperty("--bg", config.backgroundColor || "#070b14");
    root.style.setProperty("--card", config.cardColor || "#0f1626");

    var brand = document.getElementById("brandName");
    if (brand) brand.textContent = config.brandName || "Course Cabinet";
  }

  function getTelegramUser() {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) return null;
    return tg.initDataUnsafe.user;
  }

  function getUserName(user) {
    if (!user) return "Student";
    var full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return full || user.username || "Student";
  }

  function getInitials(name) {
    var clean = (name || "Student").trim();
    var words = clean.split(/\s+/).filter(Boolean);
    if (!words.length) return "ST";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function loadCompleted() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveCompleted(ids) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  function markCompleted(id) {
    var completed = loadCompleted();
    if (!completed.includes(id)) {
      completed.push(id);
      saveCompleted(completed);
    }
  }

  function resetCompleted() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function normalizeLesson(raw) {
    return {
      course_id: raw.course_id,
      lesson_id: raw.lesson_id,
      day_number: Number(raw.day_number || 0),
      title: raw.title || "Untitled",
      subtitle: raw.subtitle || "",
      preview_image_url: raw.preview_image_url || "",
      video_url: raw.video_url || "",
      content_html: raw.content_html || "",
      content_text: raw.content_text || "",
      attachments: raw.attachments || "",
      is_locked: String(raw.is_locked || "0") === "1"
    };
  }

  async function fetchLessons(config) {
    var url = config.useSampleData ? (config.sampleCsvPath || "./sample-sheet.csv") : config.googleSheetCsvUrl;
    if (!url) throw new Error("CSV URL is missing. Update config.js");

    var response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not load lessons. Check your CSV URL/public access.");
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

  function renderDashboard(lessons, config) {
    var user = getTelegramUser();
    var name = getUserName(user);
    var avatar = document.getElementById("avatar");
    var studentName = document.getElementById("studentName");
    var courseBadge = document.getElementById("courseBadge");
    var telegramBadge = document.getElementById("telegramBadge");
    var list = document.getElementById("lessonsContainer");
    var stateBox = document.getElementById("stateBox");

    studentName.textContent = name;
    avatar.textContent = getInitials(name);
    courseBadge.textContent = config.courseId || "Course";

    if (window.Telegram && window.Telegram.WebApp) {
      telegramBadge.textContent = "Connected to Telegram";
      telegramBadge.classList.add("connected");
    } else {
      telegramBadge.textContent = "Web mode";
    }

    if (!lessons.length) {
      list.innerHTML = "";
      stateBox.hidden = false;
      stateBox.textContent = "No lessons found for this course_id. Check config.js or sheet rows.";
      renderProgress(lessons);
      return;
    }

    stateBox.hidden = true;

    var completed = loadCompleted();
    list.innerHTML = lessons.map(function (lesson) {
      var done = completed.includes(lesson.lesson_id);
      var statusClass = done ? "done" : (lesson.is_locked ? "locked" : "open");
      var statusText = done ? "Completed ✓" : (lesson.is_locked ? "Locked" : "Open");

      return [
        '<a class="lesson-card" href="./lesson.html?id=' + encodeURIComponent(lesson.lesson_id) + '">',
        '<div class="lesson-meta"><span>Day ' + (lesson.day_number || "-") + '</span><span class="status ' + statusClass + '">' + statusText + '</span></div>',
        '<h3>' + escapeHtml(lesson.title) + '</h3>',
        '<p>' + escapeHtml(lesson.subtitle || "No description") + '</p>',
        '</a>'
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

    document.getElementById("progressText").textContent = completedCount + "/" + total + " lessons completed";
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
      stateBox.textContent = "Lesson ID not found. Open from the dashboard cards.";
      return;
    }

    var lesson = lessons.find(function (l) {
      return l.lesson_id === id;
    });

    if (!lesson) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Lesson not found for this course.";
      return;
    }

    stateBox.hidden = true;
    main.hidden = false;

    document.getElementById("lessonDay").textContent = "Day " + (lesson.day_number || "-");
    document.getElementById("lessonTitle").textContent = lesson.title;
    document.getElementById("lessonSubtitle").textContent = lesson.subtitle || "";

    var content = document.getElementById("lessonContent");
    if (lesson.content_html) {
      content.innerHTML = lesson.content_html;
    } else {
      content.textContent = lesson.content_text || "Lesson content is empty.";
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
        return '<li><a href="' + safe + '" target="_blank" rel="noopener noreferrer">Attachment ' + (i + 1) + '</a></li>';
      }).join("");
    }

    var completeBtn = document.getElementById("completeBtn");
    if (loadCompleted().includes(lesson.lesson_id)) {
      completeBtn.textContent = "Completed ✓";
      completeBtn.disabled = true;
    }

    completeBtn.addEventListener("click", function () {
      markCompleted(lesson.lesson_id);
      completeBtn.textContent = "Completed ✓";
      completeBtn.disabled = true;
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

  function showDashboardLoading() {
    var list = document.getElementById("lessonsContainer");
    list.innerHTML = [
      '<div class="lesson-card skeleton" aria-hidden="true" style="height:130px"></div>',
      '<div class="lesson-card skeleton" aria-hidden="true" style="height:130px"></div>',
      '<div class="lesson-card skeleton" aria-hidden="true" style="height:130px"></div>'
    ].join("");
  }

  function showDashboardError(message) {
    document.getElementById("lessonsContainer").innerHTML = "";
    var box = document.getElementById("stateBox");
    box.hidden = false;
    box.textContent = message;
  }

  async function init() {
    var config = getConfig();
    applyTheme(config);

    var page = document.body.getAttribute("data-page");
    if (page === "dashboard") {
      showDashboardLoading();
      document.getElementById("resetProgressBtn").addEventListener("click", function () {
        resetCompleted();
        window.location.reload();
      });
    }

    try {
      var lessons = await fetchLessons(config);
      if (page === "dashboard") renderDashboard(lessons, config);
      if (page === "lesson") renderLesson(lessons);
    } catch (error) {
      if (page === "dashboard") {
        showDashboardError(error.message || "Something went wrong while loading lessons.");
      } else {
        var stateBox = document.getElementById("lessonState");
        stateBox.classList.remove("skeleton");
        stateBox.textContent = error.message || "Could not load lesson.";
      }
    }
  }

  init();
})();
