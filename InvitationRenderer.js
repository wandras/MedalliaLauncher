/**
 * InvitationRenderer
 * ------------------
 * UI layer that:
 * - Loads Medallia script (Kampyle/Nebula)
 * - Renders invitation (HTML/CSS)
 * - Wires accept/decline handlers
 * - Triggers Medallia custom events (invite/accept/reject)
 *
 * IMPORTANT:
 * - It does NOT choose surveys.
 * - It does NOT decide on which pages to run.
 *   External controller must decide WHEN to call showInvitationForSurvey().
 */
class InvitationRenderer {
    constructor(options) {
        this.config = {
            // Medallia website ID required to load embed.js
            medalliaWebsiteId: "",

            // Event name fired by Medallia when onsite is ready
            onsiteLoadedEventName: "neb_OnsiteLoaded",

            // External hooks for tracking/debug
            // (type, payload) => void
            onEvent: null,

            // Logger hook (msg) => void
            logger: null
        };

        this.setConfig(options || {});

        // Styles/templates keyed by display name (e.g. "invitation_app")
        this.surveyStyles = {};

        // Runtime state for the current invitation
        this.state = {
            survey: null,
            invitation: null,
            okEl: null,
            koEl: null,
            containerEl: null,
            showTimer: null
        };

        // Bind handlers (no nested functions)
        this.onOnsiteLoaded = this.onOnsiteLoaded.bind(this);
        this.onAcceptClick = this.onAcceptClick.bind(this);
        this.onDeclineClick = this.onDeclineClick.bind(this);
        this.onShowTimeout = this.onShowTimeout.bind(this);

        // Internal flag to avoid multiple script injections
        this.medalliaScriptRequested = false;
    }

    /* =========================
        PUBLIC CONFIGURATION API
       ========================= */

    setConfig(partialConfig) {
        if (partialConfig && typeof partialConfig === "object") {
            Object.assign(this.config, partialConfig);
        }
        return this;
    }

    setSurveyStyles(styles) {
        this.surveyStyles = styles && typeof styles === "object" ? styles : {};
        return this;
    }

    /* =========================
        PUBLIC RENDERING API
       ========================= */

    /**
     * Ensures Medallia embed.js is requested (only once).
     * Call this early if you want to pre-load Medallia.
     */
    initMedalliaLoader() {
        return this.loadMedalliaScript();
    }

    /**
     * Shows an invitation for the given survey configuration.
     * The caller should provide the chosen survey config from SurveyEngine.
     *
     * @param {object} surveyConfig - must contain survey_id, display, delay, etc.
     */
    showInvitationForSurvey(surveyConfig) {
        if (!surveyConfig) return;

        this.state.survey = surveyConfig;
        this.state.invitation = this.resolveInvitationTemplate(surveyConfig);

        if (!this.state.invitation) {
            this.log("SURVEY: no invitation provided for display=" + surveyConfig.display);
            this.emit("invitation_missing_template", { survey_id: surveyConfig.survey_id, display: surveyConfig.display });
            return;
        }

        if (!this.loadMedalliaScript()) {
            this.emit("medallia_loader_failed", {});
            return;
        }

        this.startWhenReady();
    }

    /**
     * Removes/hides current invitation and clears timers.
     */
    teardownInvitation() {
        this.clearShowTimer();
        this.detachHandlers();
        this.hideInvitation();
        this.state.survey = null;
        this.state.invitation = null;
        this.state.okEl = null;
        this.state.koEl = null;
        this.state.containerEl = null;
    }

    /* =========================
        MEDALLIA LOADING
       ========================= */

    /**
     * Injects Medallia script if needed. Returns true if request initiated or already present.
     */
    loadMedalliaScript() {
        if (!this.config.medalliaWebsiteId) {
            this.log("SURVEY: no Medallia websiteID configured - terminating");
            return false;
        }

        // If Medallia globals already exist, we are effectively "loaded enough".
        if (typeof KAMPYLE_DATA === "object") return true;

        // Avoid injecting script multiple times.
        if (this.medalliaScriptRequested) return true;

        this.medalliaScriptRequested = true;
        this.log("SURVEY: loading Medallia script");

        var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement.firstChild;
        var s = document.createElement("script");
        s.setAttribute("type", "text/javascript");
        s.setAttribute("src", "https://nebula-cdn.kampyle.com/we/" + this.config.medalliaWebsiteId + "/onsite/embed.js");
        s.async = true;
        head.appendChild(s);

        this.emit("medallia_script_injected", { website_id: this.config.medalliaWebsiteId });
        return true;
    }

    /**
     * If KAMPYLE_DATA is ready, creates invitation immediately.
     * Otherwise, waits for the onsite loaded event.
     */
    startWhenReady() {
        if (typeof KAMPYLE_DATA === "object") {
            this.log("SURVEY: create invitation");
            this.createInvitation();
            return;
        }

        var eventName = this.config.onsiteLoadedEventName;
        this.log("SURVEY: scheduling invitation creation at " + eventName + " event");

        if ("addEventListener" in window) {
            window.addEventListener(eventName, this.onOnsiteLoaded, true);
            return;
        }

        if ("attachEvent" in window) {
            window.attachEvent("on" + eventName, this.onOnsiteLoaded);
        }
    }

    /**
     * On onsite ready event, create invitation.
     */
    onOnsiteLoaded() {
        this.createInvitation();
    }

    /* =========================
        INVITATION CREATION / UI
       ========================= */

    /**
     * Resolves the invitation template based on survey.display.
     */
    resolveInvitationTemplate(surveyConfig) {
        if (!surveyConfig || !surveyConfig.display) return null;
        return this.surveyStyles[surveyConfig.display] || null;
    }

    /**
     * Creates invitation DOM only if Medallia form data is available.
     */
    createInvitation() {
        var survey = this.state.survey;
        var inv = this.state.invitation;

        if (!survey || !inv) return;

        if (!(typeof KAMPYLE_DATA === "object" && typeof KAMPYLE_DATA.getFormData === "function" && KAMPYLE_DATA.getFormData(survey.survey_id))) {
            this.log("SURVEY: Medallia not loaded or form data missing");
            this.emit("medallia_form_data_missing", { survey_id: survey.survey_id });
            return;
        }

        this.addStyle(inv.css);
        this.addDiv(inv.html);

        this.state.okEl = document.querySelector(inv.ok_selector);
        this.state.koEl = document.querySelector(inv.ko_selector);
        this.state.containerEl = document.querySelector(inv.container_selector);

        if (!this.setHandlers()) return;

        this.showInvitation();
    }

    /**
     * Attaches click handlers to OK/KO elements.
     */
    setHandlers() {
        if (!this.state.containerEl || !this.state.okEl || !this.state.koEl) {
            this.log("SURVEY: selector of container or OK/KO buttons not matching");
            this.emit("invitation_selector_missing", {});
            return false;
        }

        this.state.okEl.addEventListener("click", this.onAcceptClick);
        this.state.koEl.addEventListener("click", this.onDeclineClick);
        return true;
    }

    /**
     * Detaches click handlers (safe no-op if elements missing).
     */
    detachHandlers() {
        if (this.state.okEl) this.state.okEl.removeEventListener("click", this.onAcceptClick);
        if (this.state.koEl) this.state.koEl.removeEventListener("click", this.onDeclineClick);
    }

    /**
     * Schedules invitation display after a delay and triggers the "invite" event.
     */
    showInvitation() {
        if (!this.state.containerEl) return;

        this.state.containerEl.style.display = "none";

        var delay = this.getDelayMs(this.state.survey);
        this.clearShowTimer();
        this.state.showTimer = window.setTimeout(this.onShowTimeout, delay);
    }

    /**
     * Timeout callback: triggers Medallia custom event and shows UI.
     */
    onShowTimeout() {
        var survey = this.state.survey;

        if (typeof KAMPYLE_UTILS === "object" && typeof KAMPYLE_UTILS.triggerCustomEvent === "function") {
            KAMPYLE_UTILS.triggerCustomEvent("survey_invite", { survey_id: survey.survey_id });
        }

        this.emit("invitation_shown", { survey_id: survey.survey_id });

        if (this.state.containerEl) {
            this.state.containerEl.style.display = "block";
        }
    }

    /**
     * Accept click handler: hides UI, emits events, and opens the Medallia form.
     */
    onAcceptClick() {
        var survey = this.state.survey;
        this.hideInvitation();

        if (typeof KAMPYLE_UTILS === "object" && typeof KAMPYLE_UTILS.triggerCustomEvent === "function") {
            KAMPYLE_UTILS.triggerCustomEvent("survey_accept", { survey_id: survey.survey_id });
        }

        this.emit("invitation_accepted", { survey_id: survey.survey_id });

        if (KAMPYLE_ONSITE_SDK && typeof KAMPYLE_ONSITE_SDK.loadForm === "function" && KAMPYLE_ONSITE_SDK.loadForm(survey.survey_id)) {
            KAMPYLE_ONSITE_SDK.showForm(survey.survey_id);
        }
    }

    /**
     * Decline click handler: hides UI and emits events.
     */
    onDeclineClick() {
        var survey = this.state.survey;
        this.hideInvitation();

        if (typeof KAMPYLE_UTILS === "object" && typeof KAMPYLE_UTILS.triggerCustomEvent === "function") {
            KAMPYLE_UTILS.triggerCustomEvent("survey_reject", { survey_id: survey.survey_id });
        }

        this.emit("invitation_declined", { survey_id: survey.survey_id });
    }

    /**
     * Hides invitation container and clears timers.
     */
    hideInvitation() {
        this.clearShowTimer();
        if (this.state.containerEl) this.state.containerEl.style.display = "none";
    }

    /**
     * Clears invitation show timer if present.
     */
    clearShowTimer() {
        if (this.state.showTimer) {
            window.clearTimeout(this.state.showTimer);
            this.state.showTimer = null;
        }
    }

    /**
     * Returns delay in ms from the survey config; falls back to 0.
     */
    getDelayMs(survey) {
        if (!survey) return 0;

        var d = survey.delay;
        if (typeof d === "undefined" || d === null) return 0;

        var n = Number(d);
        return isNaN(n) ? 0 : parseInt(n, 10);
    }

    /**
     * Adds CSS style tag to the document body.
     */
    addStyle(style) {
        if (!style) return;
        var css = document.createElement("style");
        css.setAttribute("type", "text/css");
        css.innerHTML = style;
        document.body.appendChild(css);
    }

    /**
     * Adds invitation HTML to the document body.
     */
    addDiv(html) {
        if (!html) return;
        var div = document.createElement("div");
        div.innerHTML = html;
        document.body.appendChild(div);
    }

    /* =========================
        EVENT / LOG HELPERS
       ========================= */

    /**
     * Emits an event for external tracking/debug.
     */
    emit(type, payload) {
        if (typeof this.config.onEvent === "function") {
            try {
                this.config.onEvent(type, payload || {});
            } catch (e) {
                // Swallow errors to keep rendering resilient.
            }
        }
    }

    /**
     * Logs via provided logger hook.
     */
    log(msg) {
        if (typeof this.config.logger === "function") {
            try {
                this.config.logger(msg);
            } catch (e) {
                // No-op
            }
        }
    }
}

