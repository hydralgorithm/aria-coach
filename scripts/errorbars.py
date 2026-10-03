"""Developer CLI for Aria's automated error bars.

Not a user feature, and it needs no human ratings. The builders run it once,
offline, to publish how trustworthy Aria's scores are:

    python scripts/errorbars.py score --repeats 3
    python scripts/errorbars.py judge --model llama3.2:3b
    python scripts/errorbars.py analyze

`score`  -> Aria scores every benchmark answer N times (self-consistency).
`judge`  -> an independent local model scores the same answers (agreement).
`analyze`-> writes docs/eval/error-bars.json, which the app reads to display
            the published numbers.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import errorbars, store  # noqa: E402


def _fmt(value, ndigits: int = 3) -> str:
    return "n/a" if value is None else f"{value:.{ndigits}f}"


def _print_report(report: dict) -> None:
    print(f"generated {report['generated_at']}  ready={report['ready']}")
    rel = report["reliability"]
    print(
        f"  reliability (Aria vs itself): {rel['answers_with_repeated_runs']} answers, "
        f"mean SD={_fmt(rel['mean_sd'], 2)}, mean range={_fmt(rel['mean_range'], 2)}"
    )
    print("  convergent validity (objective features vs Aria dimensions):")
    for row in report["convergent"]:
        print(
            f"    {row['dimension']:<22} vs {row['feature']:<16} "
            f"rho={_fmt(row['rho'], 2)} (n={row['n']})  {row['verdict']}"
        )
    disc = report.get("discrimination")
    if disc:
        print(
            f"  discrimination (can Aria tell weak from strong?): "
            f"AUC={_fmt(disc['auc'], 2)} "
            f"weak mean={_fmt(disc['mean_weak'], 1)} vs strong mean="
            f"{_fmt(disc['mean_strong'], 1)}"
        )
    judge = report.get("independent_judge")
    if judge:
        overall = judge["overall"]
        print(
            f"  independent judge ({judge['model']}): kappa={_fmt(overall['kappa'])} "
            f"alpha={_fmt(overall['alpha'])} MAE={_fmt(overall['mae'], 2)} "
            f"level delta={_fmt(overall.get('mean_level_delta'), 1)} "
            f"({judge['answers']} answers)"
        )
    else:
        print("  independent judge: none recorded")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    score = sub.add_parser("score", help="Aria scores the benchmark N times each")
    score.add_argument("--repeats", type=int, default=3)
    score.add_argument("--reset", action="store_true", help="clear Aria runs first")

    judge = sub.add_parser("judge", help="an independent model scores the benchmark")
    judge.add_argument("--model", default="", help="defaults to OLLAMA_MODEL")
    judge.add_argument("--reset", action="store_true", help="clear judge runs first")

    sub.add_parser("analyze", help="write docs/eval/error-bars.json")
    sub.add_parser("status", help="show what data exists so far")

    args = parser.parse_args(argv)

    if args.command == "score":
        from backend import brain, coach

        eval_set = errorbars.load_eval_set()
        if args.reset:
            store.clear_aria_runs(source="aria")
        engine = ""
        for answer in eval_set["answers"]:
            question = {
                "id": int(answer["id"]),
                "type": answer.get("qtype", "behavioral"),
                "question": answer["question"],
                "why": "",
                "competency": answer.get("competency", ""),
            }
            if not args.reset and store.eval_run_count(
                int(answer["id"]), "aria"
            ) >= args.repeats:
                print(f"  answer {answer['id']:>2} already scored - skipping")
                continue
            store.clear_eval_runs_for(int(answer["id"]), "aria")
            for run in range(1, args.repeats + 1):
                record = coach._score_question(question, answer["answer"])
                engine = brain.LAST_ENGINE or engine
                store.save_aria_run(
                    int(answer["id"]), run, record["score"], record["breakdown"],
                    engine, source="aria",
                )
                print(
                    f"  answer {answer['id']:>2} run {run}/{args.repeats} -> "
                    f"{record['score']}/100 [{engine}]"
                )
        print(f"stored Aria runs: {len(eval_set['answers'])} x {args.repeats}")
        return 0

    if args.command == "judge":
        from backend import brain

        model = args.model or brain.OLLAMA_MODEL
        if not brain.ollama_available():
            print(
                "no local Ollama server found. Start Ollama, or pass --model for a "
                "model that is pulled. The judge is optional; reliability and "
                "convergent validity do not need it."
            )
            return 1
        eval_set = errorbars.load_eval_set()
        if args.reset:
            store.clear_aria_runs(source=model)
        for answer in eval_set["answers"]:
            if not args.reset and store.eval_run_count(int(answer["id"]), model) >= 1:
                print(f"  answer {answer['id']:>2} already judged - skipping")
                continue
            store.clear_eval_runs_for(int(answer["id"]), model)
            result = errorbars.judge_scores(
                answer["question"], answer["answer"], model
            )
            store.save_aria_run(
                int(answer["id"]), 1, result["score"], result["breakdown"],
                f"ollama:{model}", source=model,
            )
            print(
                f"  answer {answer['id']:>2} judge {model} -> {result['score']}/100"
            )
        print(f"stored judge runs for {len(eval_set['answers'])} answers ({model})")
        return 0

    if args.command == "analyze":
        report = errorbars.write_report()
        _print_report(report)
        print(f"wrote {errorbars.REPORT_PATH}")
        return 0

    if args.command == "status":
        try:
            total = len(errorbars.load_eval_set()["answers"])
        except Exception as exc:  # noqa: BLE001
            print(f"eval set unavailable: {exc}")
            return 1
        sources = store.eval_sources()
        print(f"eval answers   : {total}")
        print(f"run sources    : {', '.join(sources) if sources else '(none yet)'}")
        for source in sources:
            print(f"  - {source}: {len(store.aria_runs(source=source))} runs")
        print(f"report on disk : {errorbars.REPORT_PATH}")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
