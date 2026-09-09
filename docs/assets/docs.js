/**
 * Plainly Reference Documentation — interactions.
 * Shared highlighting/run logic with the book, plus docs-specific search.
 */
;(function () {
  "use strict"

  var KEYWORDS = ["say", "set", "if", "otherwise", "for", "each", "in", "repeat", "times", "function", "return", "true", "false", "and", "or", "not"]
  var BUILTINS = ["uppercase", "lowercase", "trim", "split", "join", "contains", "replace", "abs", "round", "floor", "ceil", "min", "max", "number", "text", "push", "list", "length"]

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  function highlight(src) {
    var out = ""
    var i = 0
    var n = src.length
    while (i < n) {
      var ch = src[i]
      if (ch === "#") {
        var endC = src.indexOf("\n", i)
        if (endC === -1) endC = n
        out += '<span class="tok-com">' + escapeHtml(src.slice(i, endC)) + "</span>"
        i = endC
        continue
      }
      if (ch === '"') {
        var j = i + 1
        while (j < n && src[j] !== '"') {
          if (src[j] === "\\") j++
          j++
        }
        j = Math.min(j + 1, n)
        out += '<span class="tok-str">' + escapeHtml(src.slice(i, j)) + "</span>"
        i = j
        continue
      }
      if (ch >= "0" && ch <= "9") {
        var k = i
        while (k < n && ((src[k] >= "0" && src[k] <= "9") || src[k] === ".")) k++
        out += '<span class="tok-num">' + escapeHtml(src.slice(i, k)) + "</span>"
        i = k
        continue
      }
      if (/[A-Za-z_]/.test(ch)) {
        var w = i
        while (w < n && /[A-Za-z0-9_]/.test(src[w])) w++
        var word = src.slice(i, w)
        var after = src.slice(w).match(/^\s*\(/)
        if (KEYWORDS.indexOf(word) !== -1) {
          out += '<span class="tok-kw">' + word + "</span>"
        } else if (after && BUILTINS.indexOf(word) !== -1) {
          out += '<span class="tok-fn">' + word + "</span>"
        } else {
          out += escapeHtml(word)
        }
        i = w
        continue
      }
      out += escapeHtml(ch)
      i++
    }
    return out
  }

  function highlightAll() {
    var blocks = document.querySelectorAll("pre[data-lang=\"plainly\"]")
    for (var b = 0; b < blocks.length; b++) {
      var pre = blocks[b]
      if (pre.dataset.highlighted) continue
      pre.innerHTML = highlight(pre.textContent)
      pre.dataset.highlighted = "1"
    }
  }

  /**
   * Give every bare example (inside .api-body cards) a Try it / Copy bar.
   * Examples already wrapped in a .codeblock come with their own buttons.
   */
  function injectTryBars() {
    var pres = document.querySelectorAll("pre[data-lang=\"plainly\"]")
    for (var i = 0; i < pres.length; i++) {
      var pre = pres[i]
      var holder = pre.parentElement
      if (!holder || holder.classList.contains("codeblock")) continue
      if (holder.querySelector(".trybar")) continue
      var bar = document.createElement("div")
      bar.className = "trybar"
      bar.innerHTML = '<button class="cb-btn run" type="button">▶ Try it</button>' +
                      '<button class="cb-btn copy" type="button">Copy</button>'
      pre.parentNode.insertBefore(bar, pre)
    }
  }

  // ---------------- run buttons ----------------
  function ensureOutputPanel(pre) {
    var panel = pre.nextElementSibling
    while (panel && !panel.classList.contains("run-panel")) {
      panel = panel.nextElementSibling
    }
    if (!panel) {
      panel = document.createElement("div")
      panel.className = "run-panel"
      pre.parentNode.insertBefore(panel, pre.nextSibling)
    }
    if (!panel.querySelector(".rp-head")) {
      var head = document.createElement("div")
      head.className = "rp-head"
      head.textContent = "Output"
      panel.appendChild(head)
    }
    if (!panel.querySelector("pre")) {
      var out = document.createElement("pre")
      panel.appendChild(out)
    }
    return panel
  }

  function wireRun() {
    var lib = window.PlainlyDocs || null
    var buttons = document.querySelectorAll(".cb-btn.run")
    for (var r = 0; r < buttons.length; r++) {
      buttons[r].addEventListener("click", function (ev) {
        var btn = ev.currentTarget
        var holder = btn.closest(".codeblock") || btn.closest(".api-body") || btn.closest(".api") || document
        var pre = holder.querySelector("pre[data-lang=\"plainly\"]")
        if (!pre || !lib) return
        var panel = ensureOutputPanel(pre)
        var src = pre.textContent
        var out = []
        var err = null
        try {
          lib.runSource(src, function (s) { out.push(s) })
        } catch (e) {
          err = e
        }
        var pre2 = panel.querySelector("pre")
        if (err && err.name === "PlainError") {
          pre2.textContent = lib.formatError(err, src)
          pre2.classList.add("err")
        } else if (err) {
          pre2.textContent = String(err)
          pre2.classList.add("err")
        } else {
          pre2.textContent = out.length > 0 ? out.join("\n") : "(no output)"
          pre2.classList.remove("err")
        }
        panel.classList.add("open")
      })
    }
    var copies = document.querySelectorAll(".cb-btn.copy")
    for (var c = 0; c < copies.length; c++) {
      copies[c].addEventListener("click", function (ev) {
        var btn = ev.currentTarget
        var holder = btn.closest(".codeblock") || btn.closest(".api-body") || btn.closest(".api") || document
        var pre = holder.querySelector("pre[data-lang=\"plainly\"]")
        if (!pre) return
        function done() {
          btn.textContent = "Copied!"
          setTimeout(function () { btn.textContent = "Copy" }, 1200)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(pre.textContent).then(done)
        } else {
          var ta = document.createElement("textarea")
          ta.value = pre.textContent
          document.body.appendChild(ta)
          ta.select()
          document.execCommand("copy")
          document.body.removeChild(ta)
          done()
        }
      })
    }
  }

  // ---------------- scrollspy ----------------
  function wireScrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.sidebar a[href^="#"]'))
    var sections = links
      .map(function (a) { return document.querySelector(a.getAttribute("href")) })
      .filter(Boolean)
    function update() {
      var scrollMid = window.scrollY + 110
      var current = sections.length > 0 ? sections[0] : null
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].offsetTop <= scrollMid) current = sections[i]
      }
      links.forEach(function (a) { a.classList.remove("active") })
      if (current) {
        var active = links.filter(function (a) { return a.getAttribute("href") === "#" + current.id })[0]
        if (active) active.classList.add("active")
      }
    }
    var ticking = false
    window.addEventListener("scroll", function () {
      if (!ticking) {
        window.requestAnimationFrame(function () { update(); ticking = false })
        ticking = true
      }
    })
    update()
  }

  // ---------------- search filter ----------------
  function wireSearch() {
    var input = document.querySelector(".searchbox input")
    if (!input) return
    var items = Array.prototype.slice.call(document.querySelectorAll(".sidebar li"))
    var headers = Array.prototype.slice.call(document.querySelectorAll(".sidebar h4"))
    var note = document.querySelector(".no-results")

    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase()
      var visible = 0
      items.forEach(function (li) {
        var text = li.textContent.toLowerCase()
        var show = q === "" || text.indexOf(q) !== -1
        li.style.display = show ? "" : "none"
        if (show) visible++
      })
      headers.forEach(function (h) {
        // hide a group header when every following li until next h4 is hidden
        var el = h.nextElementSibling
        var any = false
        while (el && el.tagName !== "H4") {
          if (el.tagName === "UL") {
            var lis = el.querySelectorAll("li")
            for (var i = 0; i < lis.length; i++) {
              if (lis[i].style.display !== "none") { any = true; break }
            }
          }
          el = el.nextElementSibling
        }
        h.style.display = any ? "" : "none"
      })
      if (note) note.style.display = (q !== "" && visible === 0) ? "block" : "none"
    })
  }

  // ---------------- drawer ----------------
  function wireDrawer() {
    var btn = document.querySelector(".menu-btn")
    var sidebar = document.querySelector(".sidebar")
    if (!btn || !sidebar) return
    btn.addEventListener("click", function () {
      sidebar.classList.toggle("open")
    })
    sidebar.addEventListener("click", function (ev) {
      if (ev.target.tagName === "A") sidebar.classList.remove("open")
    })
  }

  function boot() {
    highlightAll()
    injectTryBars()
    wireRun()
    wireScrollspy()
    wireSearch()
    wireDrawer()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot)
  } else {
    boot()
  }
})()
