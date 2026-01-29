/* =========================
    EXAMPLE USAGE (Controller)
   ========================= */

/**
 * Controller responsibilities:
 * - Decide if the current page should run surveys (page list/rules external)
 * - Build candidate survey IDs (e.g., lookup from pageName -> candidate list)
 * - Pass candidates to SurveyEngine to choose one
 * - If chosen, pass config to InvitationRenderer to display UI
 */

// 1) Inputs from your environment (NOT from Tealium b)
var pageName = window.utag_data && window.utag_data.page_name ? String(window.utag_data.page_name) : "";
var medalliaWebsiteId = window.utag_data && window.utag_data.medallia_website_id ? String(window.utag_data.medallia_website_id) : "";

// 2) External rule: decide if this page is eligible (example)
// NOTE: You said this must be external, so keep it here.
var pageToCandidatesMap = {
    "Landing:Festa della mamma:Slide 3": ["1234"],
    "Landing:Xmas Landing": ["5678"]
};

if (!pageName || !pageToCandidatesMap[pageName]) return;

var candidates = pageToCandidatesMap[pageName];

// 3) Configure engine (survey definitions)
var engine = new SurveyEngine({
    userSampling: false,
    onEvent: function (type, payload) {
        // Example: integrate with Tealium/GA4/Adobe *here* if you want
        // utag.link({ event_name: type, ...payload })
        // console.log(type, payload);
    },
    logger: function (msg) {
        // console.log(msg);
    }
});

engine.setSurveyConfigurations({
    "2467": {
        formId: "1230",
        survey_id: "1230",
        survey_name: "Funnel satisfaction survey",
        percentage: "100",
        quarantine: "20",
        priority: 10,
        display: "invitation_app",
        delay: "2000"
    },
    "27152": {
        formId: "5678",
        survey_id: "5678",
        survey_name: "App gift vouchers survey",
        percentage: "100",
        quarantine: "50",
        priority: 10,
        display: "invitation_app",
        delay: "2500"
    }
});

// 4) Choose survey
var chosenSurvey = engine.chooseSurvey(candidates);
if (!chosenSurvey) return;

// 5) Configure renderer (styles + Medallia loader)
var renderer = new InvitationRenderer({
    medalliaWebsiteId: medalliaWebsiteId,
    onEvent: function (type, payload) {
        // Example: track invitation lifecycle
        // utag.link({ event_name: type, ...payload })
    },
    logger: function (msg) {
        // console.log(msg);
    }
});

renderer.setSurveyStyles({
    invitation_app: {
        css: "/* your CSS here */",
        html: "<div id='invitation_modal'><button id='invitation_accept'>OK</button><button id='invitation_decline'>KO</button></div>",
        container_selector: "#invitation_modal",
        ok_selector: "#invitation_accept",
        ko_selector: "#invitation_decline"
    }
});

// 6) Show invitation UI
renderer.showInvitationForSurvey(chosenSurvey);

// 7) Optional: quarantine only when actually shown
// If you prefer quarantine at "shown" time (instead of at sampling pass),
// you can move quarantine logic to controller by listening to renderer events
// and calling engine.quarantineSurvey(chosenSurvey.survey_id, chosenSurvey.quarantine).

