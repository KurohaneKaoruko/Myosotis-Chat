import type { Dict } from "./zh-CN";

/** Missing keys fall back to zh-CN at lookup time. */
const en: Partial<Dict> = {
  appName: "Myosotis",
  navChat: "Chats",
  navAgents: "Agents",
  navMemory: "Memory",
  navSettings: "Settings",
  commonCancel: "Cancel",
  commonConfirm: "Confirm",
  commonSave: "Save",
  commonDelete: "Delete",
  commonClose: "Close",
};

export default en;
