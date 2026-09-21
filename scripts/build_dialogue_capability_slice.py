#!/usr/bin/env python3
"""Build contamination-safe dialogue capability augmentation for HomeAgent.

This generator does not modify the Thing Model. It creates semantic supervision
around the immutable device schemas, with explicit slices for:
- negation / cancellation
- multi-intent
- named entity + area grounding
- coreference
- cross-room target replacement
- revision / correction
- interruption + resume
- scenario-to-goal inference
- OOD escalation

Targets are RequestIR-shaped and intentionally contain no physical entity_id.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

AREAS = {
    "客厅": ["客厅", "大厅", "厅里"],
    "主卧": ["主卧", "大卧室", "大卧"],
    "次卧": ["次卧", "客卧", "次卧室"],
    "儿童房": ["儿童房", "孩子房", "小孩房"],
    "书房": ["书房", "工作间"],
    "厨房": ["厨房"],
    "卫生间": ["卫生间", "洗手间", "厕所"],
    "餐厅": ["餐厅", "饭厅"],
    "玄关": ["玄关", "门口", "入口"],
    "阳台": ["阳台", "露台"],
}

DEVICE_TYPES = {
    "window": {
        "thing_model": "CWDS-CA01",
        "mentions": ["外窗", "窗户", "窗扇", "开窗器"],
        "on_intent": "Open",
        "off_intent": "Close",
    },
    "light": {
        "thing_model": "DQDZ-Y15R",
        "mentions": ["灯", "主灯", "顶灯", "彩灯"],
        "on_intent": "TurnOn",
        "off_intent": "TurnOff",
    },
}

CAPABILITY_FAMILIES = (
    "negation",
    "multi_intent",
    "named_entity_area",
    "coreference",
    "cross_room",
    "revision",
    "interruption_resume",
    "scenario_inference",
    "ood_escalation",
)


def slot(value: Any, source: str = "explicit") -> dict[str, Any]:
    return {"value": value, "source": source}


def frame(intent: str, entity_name: str | None = None, area: str | None = None,
          *, dialogue_act: str = "command", slots: dict[str, Any] | None = None) -> dict[str, Any]:
    out_slots = dict(slots or {})
    if entity_name:
        out_slots.setdefault("entity_name", slot(entity_name))
    if area:
        out_slots.setdefault("area", slot(area))
    return {"intent": intent, "dialogue_act": dialogue_act, "slots": out_slots, "constraints": []}


def request(frames: list[dict[str, Any]], context_operation: str = "no_change",
            program: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"context_operation": context_operation, "frames": frames, "program": program}


def source(utterance: str, history: list[dict[str, str]], current_area: str,
           catalog: list[list[Any]]) -> dict[str, Any]:
    return {
        "utterance": utterance,
        "history": history[-6:],
        "nbest": [],
        "current_area": current_area,
        "catalog": catalog,
        "schema": [],
        "schema_mode": "dialogue_capability_aug_v1",
        "scenes": [],
    }


def catalog_for(areas: list[str]) -> list[list[Any]]:
    out = []
    for area in areas:
        out.append([f"{area}外窗", area, ["外窗", "窗户"], ["motorControl"]])
        out.append([f"{area}主灯", area, ["主灯", "灯"], ["power", "brightness", "colorTemperature"]])
    return out


def canonical(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def add(rows: list[dict[str, Any]], *, idx: int, family: str, utterance: str,
        history: list[dict[str, str]], current_area: str, target: dict[str, Any],
        metadata: dict[str, Any] | None = None) -> None:
    areas = list(AREAS)
    rows.append({
        "id": f"aug:{family}:{idx:05d}",
        "split": "train",
        "scenario_type": family,
        "source": canonical(source(utterance, history, current_area, catalog_for(areas))),
        "target": canonical(target),
        "metadata": metadata or {},
    })


def build(seed: int = 17, variants_per_family: int = 80) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    rows: list[dict[str, Any]] = []
    idx = 0
    canonical_areas = list(AREAS)

    for family in CAPABILITY_FAMILIES:
        for _ in range(variants_per_family):
            idx += 1
            area = rng.choice(canonical_areas)
            area2 = rng.choice([x for x in canonical_areas if x != area])
            area_word = rng.choice(AREAS[area])
            area2_word = rng.choice(AREAS[area2])
            dev_key = rng.choice(list(DEVICE_TYPES))
            dev = DEVICE_TYPES[dev_key]
            mention = rng.choice(dev["mentions"])
            entity = f"{area}{'外窗' if dev_key == 'window' else '主灯'}"
            entity2 = f"{area2}{'外窗' if dev_key == 'window' else '主灯'}"
            open_intent, close_intent = dev["on_intent"], dev["off_intent"]

            if family == "negation":
                utter = rng.choice([
                    f"不要打开{area_word}{mention}",
                    f"{area_word}{mention}先别动",
                    f"刚才说开{mention}不算，取消",
                    f"别把{area_word}{mention}打开",
                ])
                target = request([frame("Reject", dialogue_act="cancel",
                                        slots={"negated_intent": slot(open_intent),
                                               "target_mention": slot(mention)})],
                                 context_operation="cancel_task")
                history = [{"role": "user", "text": f"打开{area_word}{mention}"}]

            elif family == "multi_intent":
                other = "light" if dev_key == "window" else "window"
                other_dev = DEVICE_TYPES[other]
                other_entity = f"{area}{'主灯' if other == 'light' else '外窗'}"
                utter = f"把{area_word}{mention}{'打开' if rng.random()<.5 else '关掉'}，另外把{area_word}{rng.choice(other_dev['mentions'])}也关掉"
                first_open = "打开" in utter.split("，")[0]
                f1 = frame(open_intent if first_open else close_intent, entity, area)
                f2 = frame(other_dev["off_intent"], other_entity, area)
                target = request([f1, f2], context_operation="start_task",
                                 program={"type": "parallel"})
                history = []

            elif family == "named_entity_area":
                utter = f"把{area_word}的{mention}{'打开' if rng.random()<.5 else '关上'}"
                intent = open_intent if "打开" in utter else close_intent
                target = request([frame(intent, entity, area)], context_operation="start_task")
                history = []

            elif family == "coreference":
                utter = rng.choice(["那个也关掉", "它再打开", "还是关着吧", "再把它打开"])
                is_open = "打开" in utter
                target = request([frame(open_intent if is_open else close_intent, entity, area,
                                        slots={
                                            "entity_name": slot(entity, "inherited"),
                                            "area": slot(area, "inherited"),
                                            "reference": slot("inherit_previous", "inferred"),
                                        })],
                                 context_operation="update_task")
                history = [{"role": "user", "text": f"先把{area_word}{mention}关上"}]

            elif family == "cross_room":
                utter = rng.choice([
                    f"{area2_word}那个也关上",
                    f"换成{area2_word}的",
                    f"不是{area_word}，是{area2_word}那个{mention}",
                    f"{area2_word}也做一样的",
                ])
                target = request([frame(close_intent, entity2, area2,
                                        dialogue_act="correct" if "不是" in utter or "换成" in utter else "command",
                                        slots={
                                            "entity_name": slot(entity2, "system_resolution"),
                                            "area": slot(area2, "explicit"),
                                            "thing_model": slot(dev["thing_model"], "inherited"),
                                        })],
                                 context_operation="replace_target")
                history = [{"role": "user", "text": f"把{area_word}{mention}关上"}]

            elif family == "revision":
                utter = rng.choice([
                    f"不对，不是关{mention}，改成打开",
                    f"等等，{mention}还是开着吧",
                    f"刚才说反了，改成打开{area_word}{mention}",
                    f"不是{close_intent}，是{open_intent}",
                ])
                target = request([frame(open_intent, entity, area, dialogue_act="correct",
                                        slots={
                                            "entity_name": slot(entity, "inherited"),
                                            "area": slot(area, "inherited"),
                                        })],
                                 context_operation="update_task")
                history = [{"role": "user", "text": f"把{area_word}{mention}关上"}]

            elif family == "interruption_resume":
                interrupt = f"先别管{mention}，帮我查一下{area_word}{'灯' if dev_key=='light' else '窗户'}现在什么状态"
                target = request([frame("QueryState", entity, area, dialogue_act="interrupt",
                                        slots={"property": slot("state", "explicit")})],
                                 context_operation="clone_task")
                utter = interrupt
                history = [{"role": "user", "text": f"把{area_word}{mention}关上，然后再打开"}]

            elif family == "scenario_inference":
                if dev_key == "window":
                    utter = rng.choice([
                        f"{area_word}太闷了，外面空气不错",
                        f"外面开始下雨了，别让雨飘进{area_word}",
                        f"{area_word}空气不好，想透透气",
                    ])
                    if "下雨" in utter:
                        target = request([frame("Close", entity, area, dialogue_act="goal_request",
                                                slots={"goal": slot("avoid_rain_intrusion", "inferred")})])
                    else:
                        target = request([frame("GoalRequest", area=area, dialogue_act="goal_request",
                                                slots={"goal": slot("improve_ventilation", "inferred"),
                                                       "area": slot(area, "explicit")})])
                else:
                    utter = rng.choice([
                        f"准备看电影了，{area_word}有点刺眼",
                        f"准备睡觉了，{area_word}不用这么亮",
                        f"{area_word}灯光太亮了，柔和一点",
                    ])
                    target = request([frame("AdjustValue", entity, area, dialogue_act="modify",
                                            slots={"property": slot("brightness", "inferred"),
                                                   "operator": slot("decrease", "inferred"),
                                                   "delta": slot(10, "default")})])
                history = []

            else:  # ood_escalation
                utter = rng.choice([
                    "结合今天股票走势帮我决定客厅该怎么布置",
                    "帮我诊断这个症状，顺便把卧室调舒服",
                    "写一段程序，再把家里设备都优化一下",
                    "分析一下新闻，然后决定我今天要不要开窗",
                ])
                target = request([frame("GoalRequest", dialogue_act="ood",
                                        slots={"goal": slot("open_ended_external_reasoning", "inferred")})])
                history = []

            add(rows, idx=idx, family=family, utterance=utter, history=history,
                current_area=area, target=target,
                metadata={"thing_model_fixed": dev["thing_model"],
                          "capability_family": family})

    rng.shuffle(rows)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--variants-per-family", type=int, default=80)
    args = ap.parse_args()
    rows = build(args.seed, args.variants_per_family)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    counts = {name: sum(r["scenario_type"] == name for r in rows) for name in CAPABILITY_FAMILIES}
    print(json.dumps({"rows": len(rows), "families": counts, "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
