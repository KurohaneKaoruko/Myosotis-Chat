/** Source-language dictionary. Every key MUST exist here; en.ts may omit keys. */
const zhCN = {
  appName: "Myosotis",
  navChat: "聊天",
  navAgents: "智能体",
  navMemory: "记忆",
  navSettings: "设置",
  commonCancel: "取消",
  commonConfirm: "确定",
  commonSave: "保存",
  commonDelete: "删除",
  commonClose: "关闭",
} as const;

export default zhCN;
export type Dict = typeof zhCN;
