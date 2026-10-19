import { useState } from "react";
import { Modal, Icon } from "./ui";
import { useStore } from "../store";
import { t } from "../i18n";
import { uid } from "@myosotis/core";
import type { Scenario, ScenarioEvent } from "@myosotis/core";

/** Create / edit a story-mode scenario (world setting, opening, events, plot prompts). */
export default function ScenarioEditor({
  agentId,
  scenario,
  onClose,
}: {
  agentId: string;
  scenario: Scenario | null;
  onClose: () => void;
}) {
  const saveScenario = useStore((s) => s.saveScenario);
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState(scenario?.name ?? "");
  const [worldSetting, setWorld] = useState(scenario?.worldSetting ?? "");
  const [openingStory, setOpening] = useState(scenario?.openingStory ?? "");
  const [events, setEvents] = useState<ScenarioEvent[]>(scenario?.events ?? []);
  const [plotPrompts, setPlotPrompts] = useState((scenario?.plotPrompts ?? []).join("\n"));

  const updEvent = (id: string, patch: Partial<ScenarioEvent>) =>
    setEvents((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const save = async () => {
    if (!name.trim()) {
      showToast(t("scenarioNameRequired"), "error");
      return;
    }
    await saveScenario({
      id: scenario?.id ?? uid("scn"),
      agentId,
      name: name.trim(),
      worldSetting: worldSetting.trim(),
      openingStory: openingStory.trim(),
      events,
      plotPrompts: plotPrompts
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      createdAt: scenario?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    showToast(t("saved"), "success");
    onClose();
  };

  return (
    <Modal
      title={scenario ? t("editScenario") : t("newScenario")}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("commonCancel")}
          </button>
          <button className="btn primary" onClick={save}>
            {t("commonSave")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("scenarioName")}</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("scenarioNamePh")} autoFocus />
      </div>
      <div className="field">
        <label>{t("worldSetting")}</label>
        <textarea
          className="input"
          rows={3}
          value={worldSetting}
          onChange={(e) => setWorld(e.target.value)}
          placeholder={t("worldSettingPh")}
        />
      </div>
      <div className="field">
        <label>{t("openingStory")}</label>
        <textarea
          className="input"
          rows={3}
          value={openingStory}
          onChange={(e) => setOpening(e.target.value)}
          placeholder={t("openingStoryPh")}
        />
      </div>

      <div className="field">
        <label>{t("eventsLabel")}</label>
        <div className="desc" style={{ marginBottom: 8 }}>{t("eventsHint")}</div>
        {events.map((e) => (
          <div key={e.id} className="scenario-event">
            <div className="row" style={{ marginBottom: 6 }}>
              <input
                className="input"
                value={e.name}
                onChange={(ev) => updEvent(e.id, { name: ev.target.value })}
                placeholder={t("eventNamePh")}
                style={{ flex: 1 }}
              />
              <button
                className="icon-btn danger"
                style={{ width: 30, height: 30 }}
                onClick={() => setEvents((es) => es.filter((x) => x.id !== e.id))}
                title={t("commonDelete")}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <input
              className="input"
              value={e.trigger}
              onChange={(ev) => updEvent(e.id, { trigger: ev.target.value })}
              placeholder={t("eventTriggerPh")}
              style={{ marginBottom: 6 }}
            />
            <textarea
              className="input"
              rows={2}
              value={e.content}
              onChange={(ev) => updEvent(e.id, { content: ev.target.value })}
              placeholder={t("eventContentPh")}
            />
          </div>
        ))}
        <button
          className="btn sm"
          onClick={() => setEvents((es) => [...es, { id: uid("evt"), name: "", trigger: "", content: "" }])}
        >
          <Icon name="plus" size={13} /> {t("addEvent")}
        </button>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("plotPromptsLabel")}</label>
        <textarea
          className="input"
          rows={3}
          value={plotPrompts}
          onChange={(e) => setPlotPrompts(e.target.value)}
          placeholder={t("plotPromptsPh")}
        />
      </div>
    </Modal>
  );
}
