(function () {
  "use strict";

  var STORAGE_KEY = "nutrition_calculator_v1";

  function toNumber(value) {
    var num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  }

  function round(value) {
    return Math.round(value);
  }

  function createNutritionCalculator(options) {
    var storage = options && options.storage;
    var onPlanSaved = options && options.onPlanSaved;
    var getLessonLink = options && options.getLessonLink;

    var debug = {
      exists: false,
      storageUsed: "unknown",
      updatedAt: "",
      loadedSuccessfully: false
    };

    function getStorageType() {
      return storage && storage.type ? storage.type : "local";
    }

    async function loadPlan() {
      try {
        var raw = await storage.getItem(STORAGE_KEY);
        debug.storageUsed = getStorageType();
        if (!raw) {
          debug.exists = false;
          debug.loadedSuccessfully = true;
          return null;
        }

        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          debug.exists = false;
          debug.loadedSuccessfully = false;
          return null;
        }

        debug.exists = true;
        debug.updatedAt = parsed.updatedAt || "";
        debug.loadedSuccessfully = true;
        return parsed;
      } catch (error) {
        debug.loadedSuccessfully = false;
        return null;
      }
    }

    async function savePlan(plan) {
      await storage.setItem(STORAGE_KEY, JSON.stringify(plan));
      debug.exists = true;
      debug.storageUsed = getStorageType();
      debug.updatedAt = plan.updatedAt;
      debug.loadedSuccessfully = true;
      if (typeof onPlanSaved === "function") onPlanSaved(plan);
    }

    function getDebugInfo() {
      return {
        exists: debug.exists,
        storageUsed: debug.storageUsed,
        updatedAt: debug.updatedAt,
        loadedSuccessfully: debug.loadedSuccessfully
      };
    }

    function computePlan(input) {
      var sexShift = input.sex === "male" ? 5 : -161;
      var bmr = 10 * input.weight + 6.25 * input.height - 5 * input.age + sexShift;
      var targetCalories = bmr * input.activityFactor * input.goalFactor;

      var caloriesFloor = input.sex === "male" ? 1400 : 1200;
      var calories = round(Math.max(targetCalories, caloriesFloor));

      var protein = round(input.weight * input.proteinPerKg);
      var fats = round(input.weight * input.fatPerKg);
      var carbsCalories = calories - protein * 4 - fats * 9;
      var carbs = round(Math.max(carbsCalories / 4, 0));

      return {
        calories: calories,
        protein: protein,
        fats: fats,
        carbs: carbs
      };
    }

    function createModalMarkup() {
      var root = document.createElement("div");
      root.className = "nutrition-modal";
      root.hidden = true;
      root.innerHTML = [
        '<div class="nutrition-modal__backdrop" data-close="1"></div>',
        '<div class="nutrition-modal__sheet" role="dialog" aria-modal="true" aria-label="Калькулятор КБЖУ">',
        '<button class="nutrition-modal__close" type="button" data-close="1" aria-label="Закрыть">×</button>',
        '<div class="nutrition-modal__content"></div>',
        '</div>'
      ].join("");
      document.body.appendChild(root);
      return root;
    }

    var modalRoot = null;
    var closeTransitionCleanup = null;
    var resultRevealTimeout = null;

    function getModal() {
      if (!modalRoot) {
        modalRoot = createModalMarkup();
      }
      return modalRoot;
    }

    function formatGoal(goal) {
      if (goal === "cut") return "Сушка";
      if (goal === "loss") return "Похудение";
      return "Поддержание";
    }

    function renderForm(plan, errors) {
      var content = getModal().querySelector(".nutrition-modal__content");
      var data = plan || {};
      var errs = errors || {};

      function selected(key, value) {
        return data[key] === value ? "selected" : "";
      }

      function valueOf(key) {
        return data[key] != null ? String(data[key]) : "";
      }

      content.innerHTML = [
        '<h2 class="nutrition-title">Калькулятор КБЖУ</h2>',
        '<p class="nutrition-text">Заполни поля — рассчитаем дневные калории и макросы.</p>',
        '<form id="nutritionForm" class="nutrition-form" novalidate>',
        field("Возраст", "age", "number", valueOf("age"), errs.age, "14-80"),
        field("Рост (см)", "height", "number", valueOf("height"), errs.height, "130-220"),
        field("Вес (кг)", "weight", "number", valueOf("weight"), errs.weight, "35-250"),
        selectField("Пол", "sex", errs.sex, [
          { value: "female", label: "Женский", selected: selected("sex", "female") },
          { value: "male", label: "Мужской", selected: selected("sex", "male") }
        ]),
        selectField("Активность", "activity", errs.activity, [
          { value: "1.2", label: "Минимальная", selected: selected("activity", "1.2") },
          { value: "1.375", label: "Низкая", selected: selected("activity", "1.375") },
          { value: "1.55", label: "Средняя", selected: selected("activity", "1.55") },
          { value: "1.725", label: "Высокая", selected: selected("activity", "1.725") }
        ]),
        selectField("Цель", "goal", errs.goal, [
          { value: "maintain", label: "Поддержание", selected: selected("goal", "maintain") },
          { value: "loss", label: "Похудение", selected: selected("goal", "loss") },
          { value: "cut", label: "Сушка", selected: selected("goal", "cut") }
        ]),
        '<button class="btn btn-primary nutrition-submit" type="submit">Рассчитать</button>',
        '</form>'
      ].join("");

      content.querySelector("#nutritionForm").addEventListener("submit", onSubmitForm);
    }

    function field(label, name, type, value, error, placeholder) {
      return [
        '<label class="nutrition-field">',
        '<span>' + label + '</span>',
        '<input type="' + type + '" name="' + name + '" value="' + escapeHtml(value) + '" placeholder="' + placeholder + '" required>',
        (error ? '<small>' + escapeHtml(error) + '</small>' : ""),
        '</label>'
      ].join("");
    }

    function selectField(label, name, error, items) {
      var options = items.map(function (item) {
        return '<option value="' + item.value + '" ' + item.selected + '>' + item.label + '</option>';
      }).join("");

      return [
        '<label class="nutrition-field">',
        '<span>' + label + '</span>',
        '<select name="' + name + '" required>' + options + '</select>',
        (error ? '<small>' + escapeHtml(error) + '</small>' : ""),
        '</label>'
      ].join("");
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function validate(data) {
      var errors = {};
      if (!Number.isFinite(data.age) || data.age < 14 || data.age > 80) errors.age = "Укажи возраст от 14 до 80 лет.";
      if (!Number.isFinite(data.height) || data.height < 130 || data.height > 220) errors.height = "Рост должен быть в диапазоне 130–220 см.";
      if (!Number.isFinite(data.weight) || data.weight < 35 || data.weight > 250) errors.weight = "Вес должен быть в диапазоне 35–250 кг.";
      if (!["female", "male"].includes(data.sex)) errors.sex = "Выбери пол.";
      if (!["1.2", "1.375", "1.55", "1.725"].includes(data.activity)) errors.activity = "Выбери уровень активности.";
      if (!["maintain", "loss", "cut"].includes(data.goal)) errors.goal = "Выбери цель.";
      return errors;
    }

    async function onSubmitForm(event) {
      event.preventDefault();
      var form = event.currentTarget;
      var raw = {
        age: toNumber(form.age.value),
        height: toNumber(form.height.value),
        weight: toNumber(form.weight.value),
        sex: form.sex.value,
        activity: form.activity.value,
        goal: form.goal.value
      };

      var errors = validate(raw);
      if (Object.keys(errors).length) {
        renderForm(raw, errors);
        return;
      }

      var goalFactor = raw.goal === "cut" ? 0.8 : (raw.goal === "loss" ? 0.85 : 1);
      var proteinPerKg = raw.goal === "cut" ? 2 : (raw.goal === "loss" ? 1.9 : 1.8);
      var fatPerKg = raw.goal === "maintain" ? 1 : (raw.goal === "loss" ? 0.9 : 0.8);

      var result = computePlan({
        age: raw.age,
        height: raw.height,
        weight: raw.weight,
        sex: raw.sex,
        activityFactor: Number(raw.activity),
        goalFactor: goalFactor,
        proteinPerKg: proteinPerKg,
        fatPerKg: fatPerKg
      });

      var plan = {
        age: raw.age,
        height: raw.height,
        weight: raw.weight,
        sex: raw.sex,
        activity: raw.activity,
        goal: raw.goal,
        calories: result.calories,
        protein: result.protein,
        fats: result.fats,
        carbs: result.carbs,
        updatedAt: new Date().toISOString()
      };

      await savePlan(plan);
      renderSuccessThenResult(plan);
    }

    function clearResultRevealTimeout() {
      if (resultRevealTimeout) {
        clearTimeout(resultRevealTimeout);
        resultRevealTimeout = null;
      }
    }

    function renderSuccessThenResult(plan) {
      clearResultRevealTimeout();
      var content = getModal().querySelector(".nutrition-modal__content");

      content.innerHTML = [
        '<div class="nutrition-success" aria-live="polite">',
        '<strong class="nutrition-success__title">✓ План питания рассчитан</strong>',
        '<p class="nutrition-success__text">Результат сохранён в профиль</p>',
        '</div>'
      ].join("");

      requestAnimationFrame(function () {
        var block = content.querySelector(".nutrition-success");
        if (block) block.classList.add("is-visible");
      });

      resultRevealTimeout = setTimeout(function () {
        var block = content.querySelector(".nutrition-success");
        if (block) block.classList.add("is-hidden");

        resultRevealTimeout = setTimeout(function () {
          renderResult(plan);
          resultRevealTimeout = null;
        }, 200);
      }, 900);
    }

    function renderResult(plan) {
      var content = getModal().querySelector(".nutrition-modal__content");
      var lessonLink = typeof getLessonLink === "function" ? getLessonLink() : null;

      content.innerHTML = [
        '<h2 class="nutrition-title">Твой план готов</h2>',
        '<div class="nutrition-result">',
        '<strong>' + plan.calories + ' ккал/день</strong>',
        '<p>Б ' + plan.protein + ' · Ж ' + plan.fats + ' · У ' + plan.carbs + '</p>',
        '<p>Цель: ' + formatGoal(plan.goal) + '</p>',
        '</div>',
        '<p class="nutrition-text">Начни с этого уровня и наблюдай за динамикой 10–14 дней.</p>',
        '<p class="nutrition-text nutrition-text--success">Результат сохранён в профиль.</p>',
        '<div class="nutrition-actions">',
        '<button class="btn btn-primary" type="button" data-close="1">Понятно</button>',
        (lessonLink ? '<a class="btn" href="' + lessonLink + '">Перейти к урокам</a>' : ""),
        '</div>'
      ].join("");
    }

    function open(initialData) {
      var root = getModal();
      clearResultRevealTimeout();
      if (typeof closeTransitionCleanup === "function") {
        closeTransitionCleanup();
        closeTransitionCleanup = null;
      }
      renderForm(initialData || {
        sex: "female",
        activity: "1.375",
        goal: "maintain"
      });

      root.hidden = false;
      root.classList.remove("is-open");
      requestAnimationFrame(function () {
        root.classList.add("is-open");
      });
      document.body.classList.add("modal-open");
    }

    function close() {
      var root = getModal();
      if (root.hidden) return;
      clearResultRevealTimeout();

      var sheet = root.querySelector(".nutrition-modal__sheet");

      function finishClose() {
        if (typeof closeTransitionCleanup === "function") {
          closeTransitionCleanup();
          closeTransitionCleanup = null;
        }
        root.hidden = true;
        document.body.classList.remove("modal-open");
      }

      if (!sheet) {
        finishClose();
        return;
      }

      root.classList.remove("is-open");

      var onTransitionEnd = function (event) {
        if (event.target !== sheet || event.propertyName !== "transform") return;
        finishClose();
      };

      closeTransitionCleanup = function () {
        sheet.removeEventListener("transitionend", onTransitionEnd);
      };

      sheet.addEventListener("transitionend", onTransitionEnd);
    }

    document.addEventListener("click", function (event) {
      if (!modalRoot || modalRoot.hidden) return;
      if (event.target && event.target.getAttribute("data-close") === "1") {
        close();
      }
    });

    return {
      loadPlan: loadPlan,
      open: open,
      close: close,
      getDebugInfo: getDebugInfo,
      formatGoal: formatGoal
    };
  }

  globalThis.NutritionCalculator = {
    create: createNutritionCalculator
  };
})();
