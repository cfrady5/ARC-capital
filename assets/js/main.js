/* ARC site behaviors: mobile nav, scroll reveal, contact prefill, form guard. */
(function () {
  "use strict";

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ---------- Scroll reveal (respects prefers-reduced-motion) ---------- */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = document.querySelectorAll("[data-reveal]");
  if (!reduceMotion && "IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Contact page: prefill audience + intent from query string ---------- */
  var params = new URLSearchParams(window.location.search);
  var type = params.get("type");
  var intent = params.get("intent");

  if (type) {
    var radio = document.querySelector(
      'input[name="audience"][value="' + (type === "lp" ? "limited-partner" : "founder-company") + '"]'
    );
    if (radio) { radio.checked = true; }
  }
  var intentField = document.querySelector('input[name="intent"]');
  if (intentField && intent) { intentField.value = intent; }

  /* Contextual helper copy on the contact form */
  var helper = document.querySelector("[data-contact-helper]");
  if (helper && intent) {
    var messages = {
      conversation: "You’re scheduling an introductory conversation with our capital formation team.",
      materials: "You’re requesting investor materials — we’ll follow up by email.",
      submit: "You’re submitting a company for review by our investment team.",
      partner: "You’re starting a partnership conversation with ARC.",
      advisory: "You’re asking about advisory services — technology roadmaps, commercialization pathways, and federal contracting support."
    };
    if (messages[intent]) { helper.textContent = messages[intent]; }
  }

  /* ---------- Forms: honeypot + unconfigured-backend guard ---------- */
  document.querySelectorAll("form[data-arc-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      var hp = form.querySelector('input[name="company_website"]');
      if (hp && hp.value) { e.preventDefault(); return; } // bot filled honeypot

      if (form.action.indexOf("YOUR_FORM_ID") !== -1) {
        e.preventDefault();
        var status = form.querySelector(".form-status");
        if (status) {
          status.textContent =
            "The form backend isn’t connected yet — please email innovations@theari.us directly.";
        }
      }
    });
  });
})();
