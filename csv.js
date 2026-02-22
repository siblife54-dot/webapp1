(function () {
  "use strict";

  /**
   * Parse CSV text into an array of objects.
   * Handles:
   * - commas inside quoted cells
   * - escaped quotes ("")
   * - line breaks inside quoted cells
   */
  function parseCSV(csvText) {
    var rows = [];
    var row = [];
    var cell = "";
    var i = 0;
    var inQuotes = false;

    while (i < csvText.length) {
      var char = csvText[i];
      var nextChar = csvText[i + 1];

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        if (char === '"') {
          inQuotes = false;
          i += 1;
          continue;
        }
        cell += char;
        i += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }

      if (char === ",") {
        row.push(cell);
        cell = "";
        i += 1;
        continue;
      }

      if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
        continue;
      }

      if (char === "\r" && nextChar === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 2;
        continue;
      }

      if (char === "\r") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
        continue;
      }

      cell += char;
      i += 1;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }

    if (!rows.length) return [];

    var headers = rows[0].map(function (h) {
      return String(h || "").trim();
    });

    return rows
      .slice(1)
      .filter(function (r) {
        return r.some(function (c) {
          return String(c || "").trim() !== "";
        });
      })
      .map(function (r) {
        var obj = {};
        headers.forEach(function (header, idx) {
          obj[header] = (r[idx] || "").trim();
        });
        return obj;
      });
  }

  window.CSVUtils = {
    parseCSV: parseCSV
  };
})();
