/**
 * The Plainly Book — interactions.
 *  - Plainly syntax highlighting (no dependencies)
 *  - Live "Run" buttons powered by the real compiler bundle
 *  - Sticky sidebar scrollspy + reading progress
 *  - Mobile drawer
 */
;(function () {
  "use strict"

  // ------------------------------------------------------------------
  // 1. Syntax highlighting
  // ------------------------------------------------------------------

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

      // comment
      if (ch === "#") {
        var endC = src.indexOf("\n", i)
        if (endC === -1) endC = n
        out += '<span class="tok-com">' + escapeHtml(src.slice(i, endC)) + "</span>"
        i = endC
        continue
      }

      // string
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

      // number
      if (ch >= "0" && ch <= "9") {
        var k = i
        while (k < n && ((src[k] >= "0" && src[k] <= "9") || src[k] === ".")) k++
        out += '<span class="tok-num">' + escapeHtml(src.slice(i, k)) + "</span>"
        i = k
        continue
      }

      // word
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

  function highlightAll(root) {
    var blocks = (root || document).querySelectorAll("pre[data-lang=\"plainly\"]")
    for (var b = 0; b < blocks.length; b++) {
      var pre = blocks[b]
      if (pre.dataset.highlighted) continue
      pre.innerHTML = highlight(pre.textContent)
      pre.dataset.highlighted = "1"
    }
  }

  // ------------------------------------------------------------------
  // 2. Live run buttons (real compiler via bundle)
  // ------------------------------------------------------------------

  var compiler = null

  function getCompiler() {
    if (compiler) return compiler
    try {
      compiler = window.PlainlyBook || null
    } catch (e) {
      compiler = null
    }
    return compiler
  }

  function wireRunButtons() {
    var buttons = document.querySelectorAll(".cb-btn.run")
    for (var r = 0; r < buttons.length; r++) {
      buttons[r].addEventListener("click", function (ev) {
        var btn = ev.currentTarget
        var block = btn.closest(".codeblock")
        var pre = block.querySelector("pre[data-lang=\"plainly\"]")
        var panel = block.querySelector(".run-panel")
        var src = pre.textContent

        var lib = getCompiler()
        if (!lib) {
          panel.classList.add("open")
          panel.querySelector("pre").textContent = "Compiler not loaded. Serve this site over http(s) and reload."
          return
        }

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
          pre2.textContent = String(err && err.stack ? err.stack : err)
          pre2.classList.add("err")
        } else {
          pre2.textContent = out.length > 0 ? out.join("\n") : "(no output)"
          pre2.classList.remove("err")
        }
        panel.classList.add("open")
      })
    }

    // copy buttons
    var copies = document.querySelectorAll(".cb-btn.copy")
    for (var c = 0; c < copies.length; c++) {
      copies[c].addEventListener("click", function (ev) {
        var btn = ev.currentTarget
        var pre = btn.closest(".codeblock").querySelector("pre[data-lang=\"plainly\"]")
        var text = pre.textContent
        function done() {
          btn.textContent = "Copied!"
          setTimeout(function () { btn.textContent = "Copy" }, 1200)
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done)
        } else {
          var ta = document.createElement("textarea")
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand("copy")
          document.body.removeChild(ta)
          done()
        }
      })
    }
  }

  // ------------------------------------------------------------------
  // 3. Scrollspy + reading progress
  // ------------------------------------------------------------------

  function wireScrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.sidebar ol a[href^="#"]'))
    var chapters = links
      .map(function (a) { return document.querySelector(a.getAttribute("href")) })
      .filter(Boolean)

    var fill = document.querySelector(".progress-fill")
    function update() {
      var scrollMid = window.scrollY + 120
      var current = chapters.length > 0 ? chapters[0] : null
      for (var i = 0; i < chapters.length; i++) {
        if (chapters[i].offsetTop <= scrollMid) current = chapters[i]
      }
      links.forEach(function (a) { a.classList.remove("active") })
      if (current) {
        var active = links.filter(function (a) { return a.getAttribute("href") === "#" + current.id })[0]
        if (active) {
          active.classList.add("active")
          // keep active item visible in the sidebar
          if (active.scrollIntoViewIfNeeded) {
            try { active.scrollIntoViewIfNeeded(false) } catch (e) { /* noop */ }
          }
        }
      }
      // progress
      var docH = document.documentElement.scrollHeight - window.innerHeight
      if (fill) fill.style.width = (docH > 0 ? Math.min(100, (window.scrollY / docH) * 100) : 0) + "%"
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

  // ------------------------------------------------------------------
  // 4. Mobile drawer
  // ------------------------------------------------------------------

  function wireDrawer() {
    var btn = document.querySelector(".menu-btn")
    var sidebar = document.querySelector(".sidebar")
    if (!btn || !sidebar) return
    btn.addEventListener("click", function () {
      var open = sidebar.classList.toggle("open")
      btn.setAttribute("aria-expanded", open ? "true" : "false")
    })
    sidebar.addEventListener("click", function (ev) {
      if (ev.target.tagName === "A") sidebar.classList.remove("open")
    })
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------

  function boot() {
    highlightAll(document)
    wireRunButtons()
    wireScrollspy()
    wireDrawer()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot)
  } else {
    boot()
  }
})()
