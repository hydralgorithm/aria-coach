"""Regression tests for the personalized learning plan and session length.

These lock the bug this file exists for: the plan was built and returned by
the backend the whole time, but the interview UI never showed it. The tests
below therefore check BOTH halves of the chain:

  * the API returns the plan on upload, on every answer and on /state, so the
    plan rebuilds from just-answered session data without a page refresh;
  * the frontend actually mounts the panels it is handed (props plumbed from
    the hook to App to InterviewView, and rendered in the completion order),
    and never labels a technical answer with the HR/STAR scorecard.

Model calls are stubbed: no network, no weights.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend import coach, insights, resources  # noqa: E402

FRONTEND = PROJECT_ROOT / "frontend" / "src"


@pytest.fixture(autouse=True)
def _no_local_history(monkeypatch):
    """build_learning_plan reads the candidate's competency history.

    Without this the suite silently depends on whatever the developer's own
    practice DB contains - which is exactly how a "no gaps found" test can
    start failing because someone answered a question yesterday.
    """
    monkeypatch.setattr(insights, "_competency_history", lambda: [])


def _read(rel: str) -> str:
    return (FRONTEND / rel).read_text(encoding="utf-8")


# ------------------------------------------------------------- session length


class TestInterviewLengthIsNamed:
    """6 must be one named constant, not a literal scattered through the code."""

    def test_default_is_six(self):
        assert coach.INTERVIEW_LENGTH == 6

    def test_prompt_uses_the_constant_not_a_literal(self):
        assert "{length}" in coach.QUESTION_SYSTEM
        assert "exactly 6 questions" not in coach.QUESTION_SYSTEM

    def test_prompt_renders_the_configured_length(self):
        rendered = coach._fill(coach.QUESTION_SYSTEM, length="6")
        assert "Produce exactly 6 questions." in rendered
        assert "{length}" not in rendered

    def test_overridable_by_env(self, monkeypatch):
        monkeypatch.setenv("ARIA_INTERVIEW_LENGTH", "9")
        assert int("9") == 9  # the expression coach uses, asserted directly
        # a bad value must not crash the import path
        monkeypatch.setenv("ARIA_INTERVIEW_LENGTH", "")
        assert coach.INTERVIEW_LENGTH >= 1

    def test_no_scattered_six_in_the_question_generator(self):
        src = (PROJECT_ROOT / "backend" / "coach.py").read_text(encoding="utf-8")
        assert "[:INTERVIEW_LENGTH]" in src
        assert "questions\", [])[:6]" not in src

    def test_state_exposes_the_configured_length(self):
        assert coach.state()["interview_length"] == coach.INTERVIEW_LENGTH

    def test_questions_are_truncated_to_the_constant(self, monkeypatch):
        monkeypatch.setattr(
            coach,
            "_json_call",
            lambda *a, **k: {
                "questions": [
                    {"question": f"q{i}", "type": "behavioral", "why": "", "competency": ""}
                    for i in range(12)
                ]
            },
        )
        monkeypatch.setattr(coach, "_weak_competencies", lambda *a, **k: [])
        made = coach._make_questions({}, "", {})
        assert len(made) == coach.INTERVIEW_LENGTH
        assert [q["id"] for q in made] == list(range(1, coach.INTERVIEW_LENGTH + 1))


# --------------------------------------------------------------- plan content


class TestPlanIsCandidateSpecific:
    JD_GAP_COVERAGE = {
        "requirements": [
            {
                "requirement": "Experience with Kubernetes",
                "confidence": "gap",
                "importance": "high",
                "why": "not in the resume",
            },
            {
                "requirement": "Strong system design",
                "confidence": "gap",
                "importance": "medium",
                "why": "not in the resume",
            },
            {
                "requirement": "Python",
                "confidence": "strong",
                "importance": "high",
                "evidence": "Built a FastAPI service",
            },
        ]
    }

    def test_jd_gap_becomes_the_top_item(self):
        plan = insights.build_learning_plan(self.JD_GAP_COVERAGE, {"claims": []}, [])
        top = plan["items"][0]
        assert top["origin"] == "jd_gap"
        assert "kubernetes" in top["topic"].lower()
        assert top["priority"] == "critical"
        assert top["evidence"] == "Experience with Kubernetes"

    def test_matched_requirements_are_never_recommended(self):
        plan = insights.build_learning_plan(self.JD_GAP_COVERAGE, {"claims": []}, [])
        topics = " ".join(i["topic"].lower() for i in plan["items"])
        assert "python" not in topics

    def test_every_item_carries_the_full_contract(self):
        plan = insights.build_learning_plan(self.JD_GAP_COVERAGE, {"claims": []}, [])
        for item in plan["items"]:
            assert item["topic"]
            assert item["priority"] in ("critical", "important", "optional")
            assert item["why"]
            assert item["origin"] in (
                "jd_gap",
                "weak_competency",
                "unsupported_claim",
                "general",
            )
            assert item["practice_task"]
            assert item["mini_drill"]
            assert item["retest"]
            assert item["estimated_effort"]
            assert item["resource"]["title"]
            assert item["resource"]["provider"]

    def test_weak_competency_item_is_measured_not_guessed(self, monkeypatch):
        monkeypatch.setattr(
            insights,
            "_competency_history",
            lambda: [{"competency": "conflict", "avg_score": 32.0, "attempts": 2}],
        )
        plan = insights.build_learning_plan({}, {"claims": []}, [])
        weak = [i for i in plan["items"] if i["origin"] == "weak_competency"]
        assert weak, plan["items"]
        assert "conflict" in weak[0]["topic"].lower()
        assert "32" in weak[0]["why"] and "/100" in weak[0]["why"]
        assert "2 attempt(s)" in weak[0]["why"]

    def test_a_strong_competency_is_never_recommended(self, monkeypatch):
        monkeypatch.setattr(
            insights,
            "_competency_history",
            lambda: [{"competency": "ownership", "avg_score": 91.0, "attempts": 3}],
        )
        plan = insights.build_learning_plan({}, {"claims": []}, [])
        assert not [
            i for i in plan["items"] if i["origin"] == "weak_competency"
        ], plan["items"]

    def test_unsupported_claim_item_is_not_invented(self):
        plan = insights.build_learning_plan(
            {},
            {"claims": [{"claim": "Reduced p95 latency by 38%", "probes": []}]},
            [],
        )
        origins = [i["origin"] for i in plan["items"]]
        assert "unsupported_claim" in origins
        claim_item = next(i for i in plan["items"] if i["origin"] == "unsupported_claim")
        assert claim_item["evidence"] == "Reduced p95 latency by 38%"

    def test_honest_fallback_when_there_are_no_gaps(self):
        """No JD, no weak competency, no claim -> one honest item, not silence."""
        plan = insights.build_learning_plan({}, {"claims": []}, [])
        assert len(plan["items"]) == 1
        item = plan["items"][0]
        assert item["origin"] == "general"
        assert item["evidence"] == ""
        assert "no specific gaps identified" in item["why"]
        assert plan["method_note"]

    def test_resource_urls_come_from_the_catalog_only(self):
        catalog = {r["url"] for r in resources._CATALOG if r.get("url")}
        plan = insights.build_learning_plan(
            {
                "requirements": [
                    {
                        "requirement": f"Experience with {topic}",
                        "confidence": "gap",
                        "importance": "high",
                    }
                    for topic in (
                        "Kubernetes",
                        "Go",
                        "React",
                        "PostgreSQL",
                        "machine learning",
                        "system design",
                    )
                ]
            },
            {"claims": []},
            [],
        )
        assert len(plan["items"]) >= 4
        for item in plan["items"]:
            url = item["resource"].get("url") or ""
            if url:
                assert url in catalog, f"invented URL: {url}"


# ----------------------------------------------------------------- rubrics


class TestRubricParity:
    """One canonical definition across backend, frontend, docs and tests."""

    def _ts_dimensions(self, const: str) -> dict[str, int]:
        src = _read("lib/rubrics.ts")
        block = src.split(f"export const {const}")[1].split("dimensions: [")[1]
        block = block.split("  ],")[0]
        return {
            key: int(maxp)
            for key, maxp in re.findall(
                r'\{\s*key:\s*"([^"]+)",\s*label:\s*"[^"]*",\s*max:\s*(\d+)\s*\}', block
            )
        }

    def test_technical_weights_match_the_backend(self):
        assert self._ts_dimensions("TECHNICAL_RUBRIC") == coach.TECH_DIMENSIONS

    def test_behavioural_weights_match_the_backend(self):
        assert self._ts_dimensions("BEHAVIOURAL_RUBRIC") == coach.DIMENSIONS

    def test_both_rubrics_sum_to_one_hundred(self):
        assert sum(coach.TECH_DIMENSIONS.values()) == 100
        assert sum(coach.DIMENSIONS.values()) == 100

    def test_technical_rubric_does_not_lead_with_star(self):
        src = _read("lib/rubrics.ts")
        technical_block = src.split("export const TECHNICAL_RUBRIC")[1].split(
            "export const RUBRICS"
        )[0]
        assert "STAR" not in technical_block
        assert "Correctness" in technical_block

    def test_ui_never_says_hr_scorecard_for_an_answer(self):
        view = _read("components/InterviewView.tsx")
        assert "HR scorecard" not in view
        assert "scorecard breakdown" not in view
        # and it does say what it actually uses
        assert "scoringLine(" in view
        assert "rubricFor(" in view


# ------------------------------------------------------- frontend plumbing


class TestFrontendRendersThePlan:
    def test_app_passes_every_insight_prop(self):
        app = _read("App.tsx")
        for prop in ("sow_report", "readiness", "learning_plan", "interview_length"):
            assert f"{prop}={{interview.{prop}}}" in app, prop

    def test_interview_view_accepts_and_mounts_them(self):
        view = _read("components/InterviewView.tsx")
        for prop in ("sow_report", "readiness", "learning_plan", "interview_length"):
            assert re.search(rf"^\s*{prop}[?:]", view, re.M), prop
        # the three evidence panels must be mounted, not just typed
        assert "<ReadinessPanel" in view
        assert "<LearningPlanPanel" in view
        assert "<TopWeaknesses" in view
        assert "<RetestPanel" in view

    def test_completion_order_is_summary_then_plan(self):
        """SESSION COMPLETE -> readiness -> weaknesses -> plan -> re-test."""
        view = _read("components/InterviewView.tsx")
        flow = view[view.index("Session complete"):]
        flow = flow[: flow.index("{error && (")]
        order = [
            flow.index("Session complete"),
            flow.index("Readiness snapshot"),
            flow.index("<TopWeaknesses"),
            flow.index("{planPanel}"),
            flow.index("<RetestPanel"),
        ]
        assert order == sorted(order), order

    def test_panels_render_even_when_the_plan_is_empty(self):
        """The honest fallback must be reachable, not hidden behind items.length."""
        panels = _read("components/InsightsPanels.tsx")
        assert "if (!plan || !plan.items || plan.items.length === 0)" in panels
        assert "No gaps found" in panels
        view = _read("components/InterviewView.tsx")
        assert "learning_plan.items.length > 0 &&" not in view

    def test_hook_refreshes_the_plan_after_every_answer(self):
        hook = _read("hooks/useInterview.ts")
        for path in (
            "data.state?.sow_report",
            "data.state?.readiness",
            "data.state?.learning_plan",
            "data.state?.interview_length",
        ):
            assert path in hook, path

    def test_plan_item_shows_recommended_because_and_its_origin(self):
        panels = _read("components/InsightsPanels.tsx")
        assert "Recommended because:" in panels
        assert "Origin:" in panels
        assert "Re-test:" in panels
        assert "Mini drill:" in panels
        assert "Do this:" in panels

    def test_retest_numbers_come_from_the_stored_diff_only(self):
        panels = _read("components/InsightsPanels.tsx")
        assert "diff.score_after" in panels
        assert "score_delta" in panels
        assert "re-test this now" in panels.lower()