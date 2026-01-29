/**
 * SurveyEngine
 * -----------
 * Headless engine that:
 * - Applies sampling + quarantine rules
 * - Selects a survey among candidate IDs by priority
 * - Emits events for tracking via callbacks (no Tealium dependency)
 *
 * IMPORTANT:
 * - It does NOT decide which surveys are candidates for a given page.
 *   Candidate selection must be done by an external controller.
 */
class SurveyEngine {
    constructor(options) {
        this.config = {
            // If true, when a survey is excluded by sampling, it will still be quarantined
            // (mirrors the "user sampling" behavior you had before).
            userSampling: false,

            // Storage key prefix for quarantine entries
            quarantineKeyPrefix: "neb_",

            // Event hook for external tracking/logging
            // (type, payload) => void
            onEvent: null,

            // Logger hook (msg) => void
            logger: null
        };

        this.setConfig(options || {});

        // Survey configurations by surveyId (string keys)
        this.surveyConfigurations = {};
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

    setSurveyConfigurations(configurations) {
        this.surveyConfigurations = configurations && typeof configurations === "object" ? configurations : {};
        return this;
    }

    /* =========================
        PUBLIC ENGINE API
       ========================= */

    /**
     * Selects the best survey among candidates by:
     * 1) filtering by quarantine
     * 2) applying percentage sampling
     * 3) choosing the highest priority survey that passes
     *
     * @param {Array<string|number>} candidateSurveyIds - list of candidate IDs (chosen externally)
     * @returns {object|null} - chosen survey configuration or null
     */
    chooseSurvey(candidateSurveyIds) {
        var ids = this.normalizeSurveyIdToArray(candidateSurveyIds);
        if (!ids.length) return null;

        var maxPriority = -1;
        var chosen = null;

        for (var i = 0; i < ids.length; i++) {
            var surveyId = String(ids[i]);
            var cfg = this.surveyConfigurations[surveyId];

            if (!cfg) {
                this.emit("survey_missing_config", { survey_id: surveyId });
                continue;
            }

            if (typeof cfg.priority !== "number") {
                cfg.priority = parseInt(cfg.priority, 10);
            }

            if (cfg.priority > maxPriority && this.passesStorageRules(cfg)) {
                chosen = cfg;
                maxPriority = cfg.priority;
            }
        }

        if (chosen) {
            this.emit("survey_chosen", { survey_id: chosen.survey_id, priority: chosen.priority });
            return chosen;
        }

        this.emit("survey_none_chosen", { candidates: ids });
        return null;
    }

    /**
     * Marks a survey as quarantined for a given number of days (or session if days is 0).
     * This is useful if you want to quarantine when the invitation is actually shown.
     */
    quarantineSurvey(surveyId, days) {
        var sid = String(surveyId);
        var key = this.config.quarantineKeyPrefix + sid;

        if (days && days > 0) {
            this.setWithExpiry(key, "true", parseInt(days, 10));
            this.emit("survey_quarantined", { survey_id: sid, days: days, storage: "local" });
        } else {
            this.setWithExpiry(key, "true", 0);
            this.emit("survey_quarantined", { survey_id: sid, days: 0, storage: "session" });
        }
    }

    /* =========================
        INTERNAL SELECTION LOGIC
       ========================= */

    /**
     * Applies quarantine + sampling.
     * If it passes, it may set quarantine immediately (depending on your previous logic).
     */
    passesStorageRules(survey) {
        var key = this.config.quarantineKeyPrefix + survey.survey_id;
        var quarantined = !!this.getWithExpiry(key);

        if (quarantined) {
            this.emit("survey_quarantined_block", { survey_id: survey.survey_id });
            this.log("SURVEY: survey " + survey.survey_id + " is quarantined");
            return false;
        }

        // Percent sampling: e.g. "100" means always included.
        var percentage = parseInt(survey.percentage, 10);
        if (isNaN(percentage)) percentage = 0;

        var sampled = parseInt(Math.random() * 100, 10) <= percentage;

        if (sampled) {
            // Quarantine immediately upon being selected for display
            // (keeps behavior similar to your previous snippet).
            var qDays = parseInt(survey.quarantine, 10);
            if (!isNaN(qDays) && qDays > 0) {
                this.setWithExpiry(key, "true", qDays);
                this.emit("survey_quarantine_set_on_sample", { survey_id: survey.survey_id, days: qDays });
            }
            this.emit("survey_included_by_sampling", { survey_id: survey.survey_id, percentage: percentage });
            return true;
        }

        // If excluded: optionally quarantine anyway (user sampling mode).
        if (this.config.userSampling) {
            var qDays2 = parseInt(survey.quarantine, 10);
            if (!isNaN(qDays2) && qDays2 > 0) {
                this.setWithExpiry(key, "true", qDays2);
            }
            this.emit("survey_excluded_quarantined_user_sampling", { survey_id: survey.survey_id, percentage: percentage });
            this.log("SURVEY: survey " + survey.survey_id + " is excluded by sampling, and quarantined (user sampling)");
            return false;
        }

        this.emit("survey_excluded_not_quarantined_event_sampling", { survey_id: survey.survey_id, percentage: percentage });
        this.log("SURVEY: survey " + survey.survey_id + " is excluded by sampling, and not quarantined (event sampling)");
        return false;
    }

    /* =========================
        STORAGE HELPERS
       ========================= */

    /**
     * Stores a value in localStorage with TTL (days), or in sessionStorage if days is falsy/0.
     */
    setWithExpiry(key, value, days) {
        var item;

        if (days) {
            var now = new Date();
            var ttl = days * 24 * 60 * 60 * 1000;
            item = { value: value, expiry: now.getTime() + ttl };
            localStorage.setItem(key, JSON.stringify(item));
            return;
        }

        item = { value: value };
        sessionStorage.setItem(key, JSON.stringify(item));
    }

    /**
     * Reads from localStorage or sessionStorage; if expired, cleans up and returns null.
     */
    getWithExpiry(key) {
        var itemStr = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (!itemStr) return null;

        var item = JSON.parse(itemStr);
        var now = new Date();

        if (item.expiry && now.getTime() > item.expiry) {
            localStorage.removeItem(key);
            return null;
        }

        return item.value;
    }

    /* =========================
        UTILS
       ========================= */

    /**
     * Normalizes inputs such as:
     * - "1,2,3" => ["1","2","3"]
     * - [1,"2"] => ["1","2"]
     * - single value => ["value"]
     */
    normalizeSurveyIdToArray(candidateSurveyIds) {
        if (!candidateSurveyIds) return [];

        if (typeof candidateSurveyIds === "string") {
            return candidateSurveyIds.split(",").map(function (x) { return String(x).trim(); }).filter(Boolean);
        }

        if (Array.isArray(candidateSurveyIds)) {
            return candidateSurveyIds.map(function (x) { return String(x).trim(); }).filter(Boolean);
        }

        return [String(candidateSurveyIds).trim()].filter(Boolean);
    }

    /**
     * Emits an event for external tracking/debug.
     */
    emit(type, payload) {
        if (typeof this.config.onEvent === "function") {
            try {
                this.config.onEvent(type, payload || {});
            } catch (e) {
                // Swallow errors to keep the engine resilient.
            }
        }
    }

    /**
     * Logs via the provided logger hook (if any).
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


